"use client";
// Shared capability grid used by both the home welcome panel and /features.
import { useEffect, useState } from "react";

export interface FeatureInfo {
  key: string; label: string; description: string; href: string;
  status: "live" | "needs_key" | "off"; note?: string;
}

const BADGE: Record<string, { text: string; cls: string }> = {
  live: { text: "Live", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  needs_key: { text: "Needs setup", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  off: { text: "Off", cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
};

export default function FeatureGrid({ compact = false }: { compact?: boolean }) {
  const [features, setFeatures] = useState<FeatureInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/features").then((r) => r.json())
      .then((d) => setFeatures(d.features ?? []))
      .catch(() => setFeatures([])).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-sm text-zinc-500">Loading capabilities…</div>;

  return (
    <div className={`grid gap-3 ${compact ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2"}`}>
      {features.map((f) => {
        const b = BADGE[f.status] ?? BADGE.off;
        return (
          <a key={f.key} href={f.href} className="block rounded-xl border border-[#1a1f2e] bg-[#0f1117] p-4 transition hover:border-emerald-500/40 hover:bg-[#12151d]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-zinc-100">{f.label}</span>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${b.cls}`}>{b.text}</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{f.description}</p>
            {f.note && f.status !== "live" && <p className="mt-1.5 text-xs text-zinc-500">⚙ {f.note}</p>}
          </a>
        );
      })}
    </div>
  );
}
