// Jupiter aggregator integration — the same swap engine BullX/Photon use.
// FREE, no key. Docs: https://station.jup.ag/docs/apis/swap-api
//
// This module builds REAL swap transactions. Manual buys return an unsigned tx
// for the browser wallet to sign. Auto-buy / copy-trade / keeper sign server-
// side with AUTO_BUY_SIGNER_KEY (a hot wallet) — guarded by admin rails.
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { JUPITER_QUOTE_API, WSOL_MINT } from "../config";
import { fetchJson } from "../http";

export interface QuoteResult {
  inAmountLamports: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: unknown;
  raw: unknown;
}

/** Generic quote: swap `amountRaw` base units of inputMint into outputMint. */
export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: string | number,
  slippageBps: number,
): Promise<QuoteResult> {
  const url =
    `${JUPITER_QUOTE_API}/quote?inputMint=${encodeURIComponent(inputMint)}` +
    `&outputMint=${encodeURIComponent(outputMint)}` +
    `&amount=${amountRaw}&slippageBps=${slippageBps}`;
  const q = await fetchJson<any>(url);
  return {
    inAmountLamports: q.inAmount,
    outAmount: q.outAmount,
    priceImpactPct: q.priceImpactPct,
    routePlan: q.routePlan,
    raw: q,
  };
}

/** Get a swap quote for buying `outputMint` with `solAmount` SOL. */
export async function getBuyQuote(
  outputMint: string,
  solAmount: number,
  slippageBps: number,
): Promise<QuoteResult> {
  const lamports = Math.round(solAmount * 1e9);
  return getSwapQuote(WSOL_MINT, outputMint, lamports, slippageBps);
}

/** Build a swap transaction (base64) for a given wallet + quote. */
export async function buildSwapTransaction(
  quoteRaw: unknown,
  userPublicKey: string,
): Promise<string> {
  const body = {
    quoteResponse: quoteRaw,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  };
  const res = await fetchJson<{ swapTransaction: string }>(
    `${JUPITER_QUOTE_API}/swap`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return res.swapTransaction;
}

/** The server signer keypair (auto-buy / copy-trade / keeper). Null if unset. */
export function getSignerKeypair(): Keypair | null {
  const secret = process.env.AUTO_BUY_SIGNER_KEY ?? "";
  if (!secret) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(secret));
  } catch {
    return null;
  }
}

export function getSignerPublicKey(): PublicKey | null {
  return getSignerKeypair()?.publicKey ?? null;
}

/**
 * AUTO-BUY: sign + send with the server-held key. Only used when the admin has
 * explicitly enabled auto-buy AND provided a signer key. Guard heavily.
 * Returns the transaction signature.
 */
export async function signAndSendSwap(
  swapTransactionBase64: string,
  connection: Connection,
): Promise<string> {
  const keypair = getSignerKeypair();
  if (!keypair) {
    throw new Error(
      "AUTO_BUY_SIGNER_KEY is not set. Server signing is disabled.",
    );
  }
  const tx = VersionedTransaction.deserialize(
    Buffer.from(swapTransactionBase64, "base64"),
  );
  tx.sign([keypair]);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    maxRetries: 3,
  });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
