// Custodial wallet engine. Every user can generate an in-app Solana wallet,
// deposit SOL to it, trade from it, back up its private key, and withdraw.
// Secret keys are encrypted at rest (see crypto.ts) and only decrypted
// server-side to sign a transaction or to fulfil the user's own key export.
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getConnection } from "../solana/rpc";
import { getServiceClient } from "../supabase";
import {
  decryptSecret,
  encryptSecret,
  needsUpgrade,
  walletCryptoReady,
} from "./crypto";

// Keep a little SOL behind for rent + network fees on any outbound transfer.
const FEE_BUFFER_SOL = 0.003;

export interface WalletOverview {
  ready: boolean; // master key configured
  exists: boolean; // user has a wallet
  publicKey: string | null;
  balanceSol: number;
}

export interface WalletTxEntry {
  ownerId: string;
  kind: "deposit" | "withdraw" | "buy" | "sell" | "fee";
  tokenAddress?: string | null;
  solAmount?: number | null;
  signature?: string | null;
  status?: string;
  note?: string | null;
}

export interface TradeSettings {
  autoTradeEnabled: boolean;
  maxBuySol: number;
  dailyCapSol: number;
  minConfidence: number;
}

const DEFAULT_SETTINGS: TradeSettings = {
  autoTradeEnabled: false,
  maxBuySol: 0.1,
  dailyCapSol: 1,
  minConfidence: 70,
};

export async function getWalletPublicKey(ownerId: string): Promise<string | null> {
  const db = getServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("user_wallets")
    .select("public_key")
    .eq("owner_id", ownerId)
    .maybeSingle();
  return data?.public_key ?? null;
}

/** Generate a wallet for this user if they don't have one yet. Idempotent. */
export async function getOrCreateWallet(
  ownerId: string,
): Promise<{ publicKey: string }> {
  if (!walletCryptoReady()) {
    throw new Error("Custodial wallets are not enabled (WALLET_MASTER_KEY missing).");
  }
  const db = getServiceClient();
  if (!db) throw new Error("Database not configured.");
  const existing = await getWalletPublicKey(ownerId);
  if (existing) return { publicKey: existing };

  const kp = Keypair.generate();
  // Keys are bound to the owner: the ciphertext only decrypts under a key
  // derived from this user's id, so a swapped database row cannot redirect
  // signing to a different wallet.
  const secret_enc = encryptSecret(kp.secretKey, ownerId);
  const { error } = await db.from("user_wallets").insert({
    owner_id: ownerId,
    public_key: kp.publicKey.toBase58(),
    secret_enc,
  });
  if (error) {
    // Race: another request may have created it concurrently.
    const again = await getWalletPublicKey(ownerId);
    if (again) return { publicKey: again };
    throw new Error(error.message);
  }
  return { publicKey: kp.publicKey.toBase58() };
}

/** Export the user's own private key (base58 for Phantom + raw byte array). */
export async function exportSecretKey(
  ownerId: string,
): Promise<{ base58: string; array: number[] }> {
  const kp = await getUserKeypair(ownerId);
  return { base58: bs58.encode(kp.secretKey), array: Array.from(kp.secretKey) };
}

/** Decrypt and load the user's signing keypair. Throws if none / not enabled. */
export async function getUserKeypair(ownerId: string): Promise<Keypair> {
  if (!walletCryptoReady()) throw new Error("Custodial wallets are not enabled.");
  const db = getServiceClient();
  if (!db) throw new Error("Database not configured.");
  const { data } = await db
    .from("user_wallets")
    .select("secret_enc")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!data?.secret_enc) throw new Error("No wallet exists for this user.");
  const secret = decryptSecret(data.secret_enc, ownerId);

  // Lazy migration: rows still encrypted under the old single global key are
  // re-encrypted with this user's derived key the first time they are used.
  // Best-effort by design - a failed upgrade must never block a trade.
  if (needsUpgrade(data.secret_enc)) {
    try {
      await db
        .from("user_wallets")
        .update({ secret_enc: encryptSecret(secret, ownerId) })
        .eq("owner_id", ownerId);
    } catch {
      /* keep going: the legacy ciphertext still decrypts */
    }
  }

  return Keypair.fromSecretKey(secret);
}

export async function getSolBalance(publicKey: string): Promise<number> {
  const conn = await getConnection();
  const lamports = await conn.getBalance(new PublicKey(publicKey), "confirmed");
  return lamports / LAMPORTS_PER_SOL;
}

export async function getWalletOverview(ownerId: string): Promise<WalletOverview> {
  const ready = walletCryptoReady();
  const publicKey = await getWalletPublicKey(ownerId);
  let balanceSol = 0;
  if (publicKey) balanceSol = await getSolBalance(publicKey).catch(() => 0);
  return { ready, exists: Boolean(publicKey), publicKey, balanceSol };
}

export async function recordWalletTx(entry: WalletTxEntry): Promise<void> {
  const db = getServiceClient();
  if (!db) return;
  try {
    await db.from("wallet_transactions").insert({
      owner_id: entry.ownerId,
      kind: entry.kind,
      token_address: entry.tokenAddress ?? null,
      sol_amount: entry.solAmount ?? null,
      signature: entry.signature ?? null,
      status: entry.status ?? "confirmed",
      note: entry.note ?? null,
    });
  } catch {
    /* history logging must never break a trade */
  }
}

/** Send SOL from the user's custodial wallet to any address. */
export async function withdrawSol(
  ownerId: string,
  toAddress: string,
  amountSol: number,
): Promise<{ signature: string }> {
  if (!amountSol || amountSol <= 0) throw new Error("Amount must be greater than 0.");
  let toPk: PublicKey;
  try {
    toPk = new PublicKey(toAddress);
  } catch {
    throw new Error("Invalid destination address.");
  }
  const kp = await getUserKeypair(ownerId);
  const conn = await getConnection();
  const balance = await conn.getBalance(kp.publicKey, "confirmed");
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  if (lamports + FEE_BUFFER_SOL * LAMPORTS_PER_SOL > balance) {
    throw new Error("Insufficient balance (leave a little SOL for network fees).");
  }
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: toPk,
      lamports,
    }),
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = kp.publicKey;
  tx.sign(kp);
  const signature = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await conn.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  await recordWalletTx({
    ownerId,
    kind: "withdraw",
    solAmount: amountSol,
    signature,
    note: `to ${toAddress}`,
  });
  return { signature };
}

// ---- Per-user auto-trade settings ----

export async function getTradeSettings(ownerId: string): Promise<TradeSettings> {
  const db = getServiceClient();
  if (!db) return { ...DEFAULT_SETTINGS };
  const { data } = await db
    .from("user_trade_settings")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_SETTINGS };
  return {
    autoTradeEnabled: Boolean(data.auto_trade_enabled),
    maxBuySol: Number(data.max_buy_sol ?? DEFAULT_SETTINGS.maxBuySol),
    dailyCapSol: Number(data.daily_cap_sol ?? DEFAULT_SETTINGS.dailyCapSol),
    minConfidence: Number(data.min_confidence ?? DEFAULT_SETTINGS.minConfidence),
  };
}

export async function saveTradeSettings(
  ownerId: string,
  patch: Partial<TradeSettings>,
): Promise<TradeSettings> {
  const db = getServiceClient();
  if (!db) throw new Error("Database not configured.");
  const merged = { ...(await getTradeSettings(ownerId)), ...patch };
  await db.from("user_trade_settings").upsert(
    {
      owner_id: ownerId,
      auto_trade_enabled: merged.autoTradeEnabled,
      max_buy_sol: merged.maxBuySol,
      daily_cap_sol: merged.dailyCapSol,
      min_confidence: merged.minConfidence,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );
  return merged;
}
