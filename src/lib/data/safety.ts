// Rug / safety analysis. Combines DexScreener market data with on-chain
// mint + holder reads. Produces a 0-100 score (higher = safer).
//
// IMPORTANT: this is a RISK FILTER, not a prediction. A high score means
// fewer obvious rug signals — it does NOT mean the token will go up.
import { getTokenSummary } from "./dexscreener";
import { getMintInfo, getHolderConcentration } from "../solana/rpc";
import type { SafetyFactor, SafetyReport } from "../types";

export async function analyzeSafety(address: string): Promise<SafetyReport> {
  const factors: SafetyFactor[] = [];
  const notes: string[] = [];

  const [summary, mint, holders] = await Promise.all([
    getTokenSummary(address).catch(() => null),
    getMintInfo(address).catch(() => null),
    getHolderConcentration(address).catch(() => null),
  ]);

  // 1) Mint authority renounced?
  if (mint) {
    const renounced = mint.mintAuthority === null;
    factors.push({
      key: "mint_authority",
      label: "Mint authority renounced",
      ok: renounced,
      weight: 25,
      detail: renounced
        ? "No one can mint new supply."
        : "Team can still mint unlimited new tokens (dilution / rug risk).",
    });
    const freezeOk = mint.freezeAuthority === null;
    factors.push({
      key: "freeze_authority",
      label: "Freeze authority renounced",
      ok: freezeOk,
      weight: 20,
      detail: freezeOk
        ? "Your tokens cannot be frozen."
        : "Team can freeze your tokens so you cannot sell (honeypot risk).",
    });
  } else {
    notes.push("Could not read the mint account on-chain (RPC limit or new token).");
  }

  // 2) Holder concentration.
  if (holders) {
    const topOk = holders.topHolderPct < 20;
    factors.push({
      key: "top_holder",
      label: "Largest holder < 20%",
      ok: topOk,
      weight: 15,
      detail: `Largest account holds ${holders.topHolderPct.toFixed(1)}% of supply.`,
    });
    const top10Ok = holders.top10Pct < 60;
    factors.push({
      key: "top10",
      label: "Top 10 holders < 60%",
      ok: top10Ok,
      weight: 15,
      detail: `Top 10 accounts hold ${holders.top10Pct.toFixed(1)}% of supply.`,
    });
  } else {
    notes.push("Could not read holder distribution (RPC limit).");
  }

  // 3) Liquidity depth.
  if (summary) {
    const liq = summary.liquidityUsd ?? 0;
    const liqOk = liq >= 10_000;
    factors.push({
      key: "liquidity",
      label: "Liquidity >= $10k",
      ok: liqOk,
      weight: 15,
      detail: `Pool liquidity is $${Math.round(liq).toLocaleString()}. Thin liquidity = high slippage & easy rug.`,
    });

    // 4) Buy/sell balance (honeypot smell: buys but almost no sells).
    const buys = summary.txns24hBuys ?? 0;
    const sells = summary.txns24hSells ?? 0;
    const balanced = sells === 0 ? buys < 5 : buys / sells < 5;
    factors.push({
      key: "buy_sell_ratio",
      label: "Healthy buy/sell ratio",
      ok: balanced,
      weight: 10,
      detail: `24h: ${buys} buys / ${sells} sells. Many buys with near-zero sells can signal a honeypot.`,
    });
  } else {
    notes.push("No DexScreener pair found — token may be brand new or illiquid.");
  }

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const earned = factors.filter((f) => f.ok).reduce((s, f) => s + f.weight, 0);
  const score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

  const verdict: SafetyReport["verdict"] =
    score >= 70 ? "ok" : score >= 45 ? "caution" : "danger";

  return {
    address,
    score,
    verdict,
    factors,
    notes,
    updatedAt: new Date().toISOString(),
  };
}
