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
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { getServiceClient } from "@/lib/supabase";
import {
  boostPackages,
  boostsReady,
  getAdminConfig,
  type AdminConfig,
} from "@/lib/adminConfig";
import { getConnection } from "@/lib/solana/rpc";
import { withdrawSol } from "@/lib/wallet/custodial";
import { decryptSecret, encryptSecret, walletCryptoReady } from "@/lib/wallet/crypto";
import { sendEmail } from "@/lib/notify/email";
import { boostConfirmedEmail } from "@/lib/notify/emailTemplates";
import { adminEmailAllowlist, appBaseUrl } from "@/lib/config";

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
  /** Encrypted secret for this order own payment address, when it has one. */
  paySecret: string | null;
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
    paySecret: r.pay_secret ?? null,
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

  // Give this order its own payment address. This is what makes the checkout
  // work like a hosted payment page: the buyer just sends SOL, and because no
  // other order shares this address, seeing any balance here is proof of
  // payment. Falls back to the shared payout wallet if no master key is set,
  // so a missing key degrades the experience instead of blocking the sale.
  let row: any = data;
  if (walletCryptoReady()) {
    try {
      const kp = Keypair.generate();
      const { data: updated } = await db
        .from("token_boosts")
        .update({
          pay_to: kp.publicKey.toBase58(),
          pay_secret: encryptSecret(kp.secretKey, String(data.id)),
        })
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (updated) row = updated;
    } catch {
      // Keep the shared payout address; the amount-matching watcher covers it.
    }
  }
  return { ok: true, order: rowToOrder(row) };
}

/** Human name for a tier, used in receipts. */
function tierLabel(tier: number): string {
  if (tier >= 3) return "Headline";
  if (tier === 2) return "Growth";
  return "Starter";
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
  await notifyBoostConfirmed(orderId).catch(() => undefined);
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

/**
 * Move a cleared payment from the order's own address to the admin payout
 * wallet. Best-effort and safe to retry: if it fails the money still sits in an
 * address only this server can spend, and the next cron run tries again.
 */
async function sweepCharge(order: BoostOrder, payout: string): Promise<void> {
  if (!order.paySecret || !payout) return;
  const db = getServiceClient();
  if (!db) return;
  const conn = await getConnection();
  const kp = Keypair.fromSecretKey(decryptSecret(order.paySecret, order.id));
  const balance = await conn.getBalance(kp.publicKey, "confirmed");
  const FEE_LAMPORTS = 5000;
  const lamports = balance - FEE_LAMPORTS;
  if (lamports <= 0) return;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: new PublicKey(payout),
      lamports,
    }),
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = kp.publicKey;
  tx.sign(kp);
  const signature = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  await db.from("token_boosts").update({ swept_signature: signature }).eq("id", order.id);
}

/**
 * Email the buyer, and a copy to the admin, the moment a boost goes live.
 * notified_at makes this idempotent so a retried cron run cannot double-send.
 */
async function notifyBoostConfirmed(orderId: string): Promise<void> {
  const db = getServiceClient();
  if (!db) return;
  const { data } = await db.from("token_boosts").select("*").eq("id", orderId).maybeSingle();
  if (!data || (data as any).notified_at) return;
  const order = rowToOrder(data);
  if (!order.expiresAt) return;

  const cfg = await getAdminConfig();
  const recipients: string[] = [];
  const ownerId = (data as any).owner_id ?? null;

  if (ownerId) {
    const { data: u } = await db.from("app_users").select("email").eq("id", ownerId).maybeSingle();
    const email = (u as any)?.email;
    if (email) recipients.push(String(email));
  }

  const adminBox = (cfg.boostNotifyEmail || "").trim();
  if (adminBox) recipients.push(adminBox);
  else for (const a of adminEmailAllowlist()) recipients.push(a);

  const unique = Array.from(new Set(recipients.filter(Boolean)));
  if (unique.length === 0) return;

  const built = boostConfirmedEmail({
    tokenAddress: order.tokenAddress,
    tierName: tierLabel(order.tier),
    priceSol: order.priceSol,
    hours: order.durationHours,
    expiresAt: order.expiresAt,
    reference: order.reference,
    signature: order.signature,
    appUrl: appBaseUrl(),
  });

  for (const to of unique) {
    await sendEmail(to, built, "boost_confirmed", { ownerId, force: true }).catch(() => undefined);
  }
  await db
    .from("token_boosts")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", orderId);
}

/**
 * Credit boosts automatically the moment payment lands. Nothing to submit.
 *
 * Modern orders each own a payment address, so detection is exact: any SOL that
 * reaches that address can only belong to that one order. Once seen, the
 * balance is swept to the admin payout wallet. Older orders that shared the
 * payout address still work via the amount-matching scan below.
 */
export async function autoVerifyPendingBoosts(): Promise<{
  pending: number;
  scanned: number;
  activated: number;
  swept: number;
}> {
  const out = { pending: 0, scanned: 0, activated: 0, swept: 0 };

  const cfg = await getAdminConfig();
  if (!boostsReady(cfg)) return out;
  const payout = cfg.boostWallet.trim();

  const db = getServiceClient();
  if (!db) return out;

  const { data: pendingRows } = await db
    .from("token_boosts")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  const pending = (pendingRows ?? []).map(rowToOrder);
  out.pending = pending.length;

  const { data: unsweptRows } = await db
    .from("token_boosts")
    .select("*")
    .eq("status", "active")
    .is("swept_signature", null)
    .not("pay_secret", "is", null)
    .limit(25);
  const unswept = (unsweptRows ?? []).map(rowToOrder);

  if (pending.length === 0 && unswept.length === 0) return out;

  let conn;
  try {
    conn = await getConnection();
  } catch {
    return out;
  }

  const legacy: BoostOrder[] = [];

  for (const order of pending) {
    if (!order.paySecret) {
      legacy.push(order);
      continue;
    }
    out.scanned += 1;
    let lamports = 0;
    try {
      lamports = await conn.getBalance(new PublicKey(order.payTo), "confirmed");
    } catch {
      continue;
    }
    const required = Math.round(order.priceSol * LAMPORTS_PER_SOL);
    if (lamports < required * 0.995) continue;

    const expiresAt = await activate(order.id, "charge:" + order.payTo, order.durationHours);
    if (!expiresAt) continue;
    out.activated += 1;
    try {
      await sweepCharge(order, payout);
      out.swept += 1;
    } catch {
      // Retried on the next run.
    }
  }

  for (const order of unswept) {
    try {
      await sweepCharge(order, payout);
      out.swept += 1;
    } catch {
      // Retried on the next run.
    }
  }

  if (legacy.length > 0 && payout) {
    const { data: usedRows } = await db
      .from("token_boosts")
      .select("signature")
      .not("signature", "is", null)
      .limit(500);
    const used = new Set((usedRows ?? []).map((r: any) => String(r.signature)));

    let sigs;
    try {
      sigs = await conn.getSignaturesForAddress(new PublicKey(payout), { limit: 50 });
    } catch {
      return out;
    }

    const remaining = [...legacy];
    for (const info of sigs) {
      if (remaining.length === 0) break;
      if (info.err || used.has(info.signature)) continue;
      out.scanned += 1;

      let tx;
      try {
        tx = await conn.getTransaction(info.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
      } catch {
        continue;
      }
      if (!tx || !tx.meta || tx.meta.err) continue;

      const keys = tx.transaction.message
        .getAccountKeys()
        .staticAccountKeys.map((k: PublicKey) => k.toBase58());
      const idx = keys.indexOf(payout);
      if (idx < 0) continue;

      const gainedLamports =
        Number(tx.meta.postBalances[idx] ?? 0) - Number(tx.meta.preBalances[idx] ?? 0);
      if (gainedLamports <= 0) continue;
      const gainedSol = gainedLamports / LAMPORTS_PER_SOL;
      const blockMs = (info.blockTime ?? tx.blockTime ?? 0) * 1000;
      const SLACK_MS = 10 * 60 * 1000;

      const match = remaining
        .filter((o) => gainedSol >= o.priceSol * 0.995)
        .filter((o) => gainedSol <= o.priceSol * 1.25)
        .filter((o) => !blockMs || blockMs + SLACK_MS >= new Date(o.createdAt).getTime())
        .sort((a, b) => b.priceSol - a.priceSol)[0];
      if (!match) continue;

      const expiresAt = await activate(match.id, info.signature, match.durationHours);
      if (!expiresAt) continue;
      used.add(info.signature);
      remaining.splice(
        remaining.findIndex((o) => o.id === match.id),
        1,
      );
      out.activated += 1;
    }
  }

  return out;
}

/**
 * Admin-granted boost: no payment, no order, straight to active.
 * Recorded at a price of 0 with granted_by set, so it is always obvious this
 * one was given rather than sold and the revenue numbers stay honest.
 */
export async function grantBoost(opts: {
  tokenAddress: string;
  tier: number;
  hours: number;
  grantedBy: string;
}): Promise<{ ok: boolean; error?: string; order?: BoostOrder }> {
  const tokenAddress = opts.tokenAddress.trim();
  try {
    new PublicKey(tokenAddress);
  } catch {
    return { ok: false, error: "That does not look like a valid token mint address." };
  }
  const hours = Number(opts.hours);
  if (!hours || hours <= 0) {
    return { ok: false, error: "Duration must be more than 0 hours." };
  }
  const tier = Number(opts.tier) || 1;

  const db = getServiceClient();
  if (!db) return { ok: false, error: "Database is not configured." };

  const cfg = await getAdminConfig();
  const now = new Date();
  const { data, error } = await db
    .from("token_boosts")
    .insert({
      owner_id: null,
      token_address: tokenAddress,
      tier,
      price_sol: 0,
      duration_hours: hours,
      reference: newReference(),
      pay_to: cfg.boostWallet.trim(),
      status: "active",
      paid_at: now.toISOString(),
      expires_at: new Date(now.getTime() + hours * 3600_000).toISOString(),
      granted_by: opts.grantedBy,
    })
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create the boost." };
  }
  await notifyBoostConfirmed(String(data.id)).catch(() => undefined);
  return { ok: true, order: rowToOrder(data) };
}
