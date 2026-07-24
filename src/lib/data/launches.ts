// Real-time launch feed (feature #1). Two real sources, both free:
//   1) A server poll of DexScreener's newest Solana pairs (this module).
//   2) A live PumpPortal websocket in the browser (see components/LiveLaunches).
import { scanTrending } from "./dexscreener";
import { analyzeSafety } from "./safety";
import { cached } from "../cache";
import type { LaunchToken } from "../types";

export function isPumpFunMint(address: string): boolean {
  return address.toLowerCase().endsWith("pump");
}

export async function getRecentLaunches(limit = 30): Promise<LaunchToken[]> {
  return cached(`launches:${limit}`, 20_000, async () => {
    const fresh = await scanTrending("new", limit);
    const preScreenCount = Math.min(6, fresh.length);
    const safetyScores = await Promise.all(
      fresh.slice(0, preScreenCount).map((t) =>
        analyzeSafety(t.address).then((s) => s.score).catch(() => null),
      ),
    );
    return fresh.map((t, i) => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      ageMinutes: t.ageHours != null ? Math.round(t.ageHours * 60) : null,
      liquidityUsd: t.liquidityUsd,
      priceUsd: t.priceUsd,
      isPumpFun: isPumpFunMint(t.address),
      safetyScore: i < preScreenCount ? safetyScores[i] : null,
      url: t.url,
    }));
  });
}
