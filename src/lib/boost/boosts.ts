// Paid token boosts - our own promotion product, sold by us, priced by the admin.
//
// This REPLACES the dependency on a third party's paid-boost list for ranking
// the Trending feed. Everything else about the market data feed is untouched.
//
// Design rules:
//  * A boost is NEVER active until this server has seen the payment on-chain.
//    Orders are created 'pending' with the exact amount and destination we
//    expect, and only a verified transfer flips them to 'active'.
//  * Two payment paths, both automatic: pay from the in-app wallet (one click,
//    we sign and activate immediately), or pay from any external wallet and
//    submit the signature, which we verify against the chain.
//  * Expiry is computed from the moment payment cleared, not from order time,
//    so a buyer who pays an hour later still gets the full duration.
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getServiceClient } from "@/lib/supabase";
import {
  boostPackages,
  boostsReady,
  getAdminConfig,
  type AdminConfig,
} from "@/lib/adminConfig";
import { getConnection } from "@/lib/solana/rpc";
import { withdrawSol } from "@/lib/wallet/custodial";

export interface BoostOrder {
  id: string;
  tokenAddress: string;
  tier: number;
  priceSol: number;
  durationHours: number;
  reference: string;
  payTo: string;
  status: string;
  signature: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ActiveBoost {
  tokenAddress: string;
  tier: number;
  expiresAt: string;
}

function rowToOrder(r: any): BoostOrder {
  return {
    id: String(r.id),
    tokenAddress: String(r.token_address),
    tier: Number(r.tier),
    priceSol: Number(r.price_sol),
    durationHours: Number(r.duration_hours),
    reference: String(r.reference),
    payTo: String(r.pay_to),
    status: String(r.status),
    signature: r.signature ?? null,
    expiresAt: r.expires_at ?? null,
    createdAt: String(r.created_at),
  };
}

/** Short human-quotable reference the buyer can quote in support. */
function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return "BOOST-" + out;
}

/** Create a pending order for one package. Does not move any money. */
export async function createBoostOrder(
  ownerId: string | null,
  tokenAddress: string,
  tier: number,
): Promise<{ ok: boolean; error?: string; order?: BoostOrder }> {
  const cfg = await getAdminConfig();
  if (!boostsReady(cfg)) {
    return { ok: false, error: "Boosts are not currently on sale." };
  }
  const pkg = boostPackages(cfg).find((p) => p.tier === tier);
  if (!pkg) return { ok: false, error: "That boost package is not available." };

  try {
    new PublicKey(tokenAddress);
  } catch {
    return { ok: false, error: "That does not look like a valid token mint address." };
  }

  const db = getServiceClient();
  if (!db) return { ok: false, error: "Database is not configured." };

  const { data, error } = await db
    .from("token_boosts")
    .insert({
      owner_id: ownerId,
      token_address: tokenAddress,
      tier: pkg.tier,
      price_sol: pkg.priceSol,
      duration_hours: pkg.hours,
      reference: newReference(),
      pay_to: cfg.boostWallet.trim(),
      status: "pending",
    })
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create the order." };
  }
  return { ok: true, order: rowToOrder(data) };
}

async function activate(
  orderId: string,
  signature: string,
  durationHours: number,
): Promise<string | null> {
  const db = getServiceClient();
  if (!db) return null;
  const expiresAt = new Date(Date.now() + durationHours * 3600_000).toISOString();
  const { error } = await db
    .from("token_boosts")
    .update({
      status: "active",
      signature,
      paid_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .eq("id", orderId)
    .eq("status", "pending");
  if (error) return null;
  return expiresAt;
}

async function loadOrder(orderId: string): Promise<BoostOrder | null> {
  const db = getServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("token_boosts")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  return data ? rowToOrder(data) : null;
}

/**
 * Pay for a pending boost straight from the buyer's in-app wallet.
 *
 * The smooth path: no external wallet, no copy-pasting a signature. The
 * transfer is signed server-side by the buyer's own custodial key, so the money
 * comes from their balance - never from the platform's.
 */
export async function payBoostFromWallet(
  ownerId: string,
  orderId: string,
): Promise<{ ok: boolean; error?: string; signature?: string; expiresAt?: string }> {
  const order = await loadOrder(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status === "active") {
    return {
      ok: true,
      signature: order.signature ?? undefined,
      expiresAt: order.expiresAt ?? undefined,
    };
  }
  if (order.status !== "pending") {
    return { ok: false, error: "This order is no longer payable." };
  }

  let signature: string;
  try {
    const res = await withdrawSol(ownerId, order.payTo, order.priceSol);
    signature = res.signature;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const expiresAt = await activate(order.id, signature, order.durationHours);
  if (!expiresAt) {
    // The money moved but the row did not flip. Say so plainly with the
    // signature attached rather than pretending the purchase failed.
    return {
      ok: false,
      error:
        "Payment sent (" +
        signature.slice(0, 12) +
        "...) but the boost could not be activated. Contact support with this reference: " +
        order.reference,
      signature,
    };
  }
  return { ok: true, signature, expiresAt };
}

/**
 * Verify an externally-paid boost by its transaction signature.
 *
 * We read the confirmed transaction and require that the destination account's
 * balance actually increased by at least the order price. Trusting the buyer's
 * word here would let anyone activate a boost for free.
 */
export async function confirmBoostBySignature(
  orderId: string,
  signature: string,
): Promise<{ ok: boolean; error?: string; expiresAt?: string }> {
  const order = await loadOrder(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status === "active") {
    return { ok: true, expiresAt: order.expiresAt ?? undefined };
  }
  if (order.status !== "pending") {
    return { ok: false, error: "This order is no longer payable." };
  }

  const conn = await getConnection();
  let tx;
  try {
    tx = await conn.getTransaction(signature.trim(), {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
  } catch (err) {
    return {
      ok: false,
      error: "Could not read that transaction: " + (err as Error).message,
    };
  }
  if (!tx || !tx.meta) {
    return {
      ok: false,
      error:
        "That signature is not confirmed yet. Wait a few seconds after sending and try again.",
    };
  }
  if (tx.meta.err) {
    return { ok: false, error: "That transaction failed on-chain, so nothing was paid." };
  }

  const keys = tx.transaction.message
    .getAccountKeys()
    .staticAccountKeys.map((k) => k.toBase58());
  const idx = keys.indexOf(order.payTo);
  if (idx < 0) {
    return { ok: false, error: "That transaction does not pay the boost address." };
  }
  const gained =
    Number(tx.meta.postBalances[idx] ?? 0) - Number(tx.meta.preBalances[idx] ?? 0);
  const required = Math.round(order.priceSol * LAMPORTS_PER_SOL);
  // 0.5% tolerance absorbs rounding in wallets that send a "max" amount.
  if (gained < required * 0.995) {
    return {
      ok: false,
      error:
        "That transaction only sent " +
        (gained / LAMPORTS_PER_SOL).toFixed(4) +
        " SOL, but this package costs " +
        order.priceSol +
        " SOL.",
    };
  }

  const expiresAt = await activate(order.id, signature.trim(), order.durationHours);
  if (!expiresAt) {
    return { ok: false, error: "That signature has already been used for another boost." };
  }
  return { ok: true, expiresAt };
}

/** Flip finished boosts to 'expired' so ranking stops counting them. */
export async function expireBoosts(): Promise<number> {
  const db = getServiceClient();
  if (!db) return 0;
  const { data } = await db
    .from("token_boosts")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  return data?.length ?? 0;
}

/** Every currently-running boost. */
export async function getActiveBoosts(): Promise<ActiveBoost[]> {
  const db = getServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("token_boosts")
    .select("token_address, tier, expires_at")
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(200);
  return (data ?? []).map((r: any) => ({
    tokenAddress: String(r.token_address),
    tier: Number(r.tier),
    expiresAt: String(r.expires_at),
  }));
}

/**
 * Boost weight per token: the sum of active tiers. Used to rank Trending.
 */
export async function boostWeights(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const b of await getActiveBoosts()) {
    out[b.tokenAddress] = (out[b.tokenAddress] ?? 0) + b.tier;
  }
  return out;
}

/** A buyer's own orders, for the "my boosts" list. */
export async function listOwnerBoosts(ownerId: string): Promise<BoostOrder[]> {
  const db = getServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("token_boosts")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []).map(rowToOrder);
}

export function publicPackages(cfg: AdminConfig) {
  return boostPackages(cfg).map((p) => ({
    tier: p.tier,
    priceSol: p.priceSol,
    hours: p.hours,
  }));
}
