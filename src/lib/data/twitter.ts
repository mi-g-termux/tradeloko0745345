// X / Twitter social feed — OPTIONAL, admin-toggled, needs a paid bearer token.
// Uses the X API v2 recent-search endpoint. Returns real mentions + a simple
// keyword-based sentiment lean. If disabled or no key, returns a clear
// "needs key" state — never dummy data.
import { TWITTER_API_BASE } from "../config";
import { getAdminConfig } from "../adminConfig";
import { fetchJson } from "../http";
import type { SocialStats } from "../types";

interface XTweet {
  id: string;
  text: string;
  author_id?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
  };
}
interface XResponse {
  data?: XTweet[];
  meta?: { result_count?: number };
}

const BULLISH = [
  "moon", "pump", "pumping", "buy", "buying", "bull", "bullish", "send",
  "sending", "ape", "aping", "gem", "1000x", "100x", "lfg", "breakout",
  "runner", "early", "accumulate", "long",
];
const BEARISH = [
  "rug", "rugged", "scam", "dump", "dumping", "dead", "honeypot", "exit",
  "sell", "selling", "bear", "bearish", "avoid", "careful", "ponzi", "jeet",
  "top", "short",
];

function scoreSentiment(tweets: XTweet[]): number {
  if (tweets.length === 0) return 0;
  let net = 0;
  for (const t of tweets) {
    const lc = t.text.toLowerCase();
    let s = 0;
    for (const w of BULLISH) if (lc.includes(w)) s += 1;
    for (const w of BEARISH) if (lc.includes(w)) s -= 1;
    net += Math.max(-1, Math.min(1, s));
  }
  return Math.max(-1, Math.min(1, net / tweets.length));
}

/**
 * Fetch recent X mentions for a token. Prefer the $CASHTAG; also include the
 * contract address so we catch "CA: ..." posts.
 */
export async function getSocialStats(
  symbol: string,
  address: string,
): Promise<SocialStats> {
  const cfg = await getAdminConfig();
  if (!cfg.xFeedEnabled) {
    return { available: false, needsKey: false, mentionCount: 0, sentiment: 0, topTweets: [] };
  }
  if (!cfg.xBearerToken) {
    return { available: false, needsKey: true, mentionCount: 0, sentiment: 0, topTweets: [] };
  }

  const clean = symbol.replace(/[^a-zA-Z0-9]/g, "");
  const query = `(\$${clean} OR "${address}") -is:retweet`;
  const url =
    `${TWITTER_API_BASE}/tweets/search/recent` +
    `?query=${encodeURIComponent(query)}` +
    `&max_results=50&tweet.fields=public_metrics,author_id`;

  try {
    const res = await fetchJson<XResponse>(url, {
      headers: { Authorization: `Bearer ${cfg.xBearerToken}` },
      timeoutMs: 12_000,
    });
    const tweets = res.data ?? [];
    const sentiment = scoreSentiment(tweets);
    const topTweets = [...tweets]
      .sort(
        (a, b) =>
          (b.public_metrics?.like_count ?? 0) -
          (a.public_metrics?.like_count ?? 0),
      )
      .slice(0, 5)
      .map((t) => ({
        text: t.text,
        likes: t.public_metrics?.like_count ?? 0,
        url: `https://twitter.com/i/web/status/${t.id}`,
      }));
    return {
      available: true,
      needsKey: false,
      mentionCount: res.meta?.result_count ?? tweets.length,
      sentiment,
      topTweets,
    };
  } catch {
    return { available: false, needsKey: true, mentionCount: 0, sentiment: 0, topTweets: [] };
  }
}
