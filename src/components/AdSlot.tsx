"use client";
// Renders whatever creative the admin assigned to a slot.
//
// Design rules:
//  - If ads are OFF or the slot is empty, this renders NOTHING (no grey box,
//    no reserved gap), so the layout is identical to an ad-free site.
//  - Clicks are counted through /api/ads/click, then the browser navigates.
//  - HTML creatives (AdSense / affiliate script snippets) are inserted only
//    because an authenticated admin authored them; this is the same trust level
//    as any ad-tag field in a CMS.
import { useEffect, useRef, useState } from "react";
import type { AdSlotId } from "@/lib/types";
import { cx } from "./ui";

interface ServedAd {
  id: string;
  slot: AdSlotId;
  title: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  html: string | null;
}

export default function AdSlot({
  slot,
  className,
}: {
  slot: AdSlotId;
  className?: string;
}) {
  const [ad, setAd] = useState<ServedAd | null>(null);
  const htmlRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ads?slot=${slot}`)
      .then((r) => r.json())
      .then((j) => {
        if (alive) setAd(j.ad ?? null);
      })
      .catch(() => {
        // An ad failing to load must never disturb the page.
        if (alive) setAd(null);
      });
    return () => {
      alive = false;
    };
  }, [slot]);

  // <script> tags inserted via innerHTML do not execute, so re-create them.
  // This is what makes AdSense / affiliate snippets actually run.
  useEffect(() => {
    const host = htmlRef.current;
    if (!host || !ad?.html) return;
    const scripts = Array.from(host.querySelectorAll("script"));
    for (const old of scripts) {
      const s = document.createElement("script");
      for (const attr of Array.from(old.attributes)) {
        s.setAttribute(attr.name, attr.value);
      }
      s.text = old.text;
      old.replaceWith(s);
    }
  }, [ad?.html]);

  if (!ad) return null;

  const countClick = () => {
    // keepalive so the count survives the navigation away from the page.
    void fetch("/api/ads/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ad.id }),
      keepalive: true,
    }).catch(() => {});
  };

  const body = ad.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ad.imageUrl}
      alt={ad.title ?? "Sponsored"}
      className="h-auto w-full rounded-card object-cover"
      loading="lazy"
    />
  ) : (
    <div ref={htmlRef} dangerouslySetInnerHTML={{ __html: ad.html ?? "" }} />
  );

  return (
    <div className={cx("relative", className)}>
      {/* Disclosure label — required by most ad networks and by app stores. */}
      <span className="absolute right-1 top-1 z-10 rounded bg-black/60 px-1 py-0.5 text-[9px] uppercase tracking-wide text-mute">
        Ad
      </span>
      {ad.linkUrl ? (
        <a
          href={ad.linkUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={countClick}
          className="block"
        >
          {body}
        </a>
      ) : (
        body
      )}
    </div>
  );
}
