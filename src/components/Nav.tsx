"use client";
// Top navigation — DexScreener-style: admin-configurable logo on the left,
// dense nav links, search shortcut, then the auth button.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthButton } from "./AuthButton";
import { cx } from "./ui";
import type { Branding } from "@/lib/types";

const LINKS = [
  { href: "/", label: "Scanner" },
  { href: "/launches", label: "New pairs" },
  { href: "/signals", label: "Signals" },
  { href: "/whales", label: "Whales" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/orders", label: "Orders" },
  { href: "/wallet", label: "Wallet" },
  { href: "/account", label: "Account" },
];

export default function Nav() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => setIsAdmin(Boolean(j.user?.isAdmin)))
      .catch(() => setIsAdmin(false));

    // Branding is public, so the logo appears before sign-in.
    fetch("/api/branding")
      .then((r) => r.json())
      .then((j) => setBranding(j.branding ?? null))
      .catch(() => setBranding(null));
  }, []);

  const links = isAdmin ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;
  const appName = branding?.appName ?? "MemePump";
  const showLogo = Boolean(branding?.logoUrl) && !logoBroken;

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-panel/85 backdrop-blur">
      <div className="mx-auto flex h-[52px] max-w-[1600px] items-center gap-3 px-3 sm:px-4">
        {/* ── Brand: admin-uploaded logo, exactly like DexScreener's top-left ── */}
        <Link href="/" className="flex shrink-0 items-center gap-2">
          {showLogo ? (
            /* Intentionally a plain <img>: the logo URL is admin-supplied and
               arbitrary, so next/image's domain allowlist would reject it. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding?.logoUrl ?? ""}
              alt={appName}
              style={{ height: branding?.logoHeight ?? 28 }}
              className="w-auto object-contain"
              onError={() => setLogoBroken(true)}
            />
          ) : (
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-black text-white">
              {appName.slice(0, 1).toUpperCase()}
            </span>
          )}
          {(!showLogo || branding?.showAppNameBesideLogo !== false) && (
            <span className="text-sm font-bold tracking-tight text-ink">
              {appName}
            </span>
          )}
        </Link>

        {/* ── Desktop links ── */}
        <nav className="scroll-x hidden flex-1 items-center gap-1 md:flex">
          {links.map((l) => {
            const active =
              l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cx(
                  "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
                  active
                    ? "bg-panel2 text-ink"
                    : "text-mute hover:bg-panel2/60 hover:text-ink",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <AuthButton />
          <button
            type="button"
            aria-label="Menu"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-edge px-2 py-1.5 text-xs text-mute md:hidden"
          >
            ☰
          </button>
        </div>
      </div>

      {/* ── Mobile drawer ── */}
      {open ? (
        <nav className="grid grid-cols-2 gap-1 border-t border-edge bg-panel px-3 py-2 md:hidden">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-2.5 py-2 text-xs text-mute hover:bg-panel2 hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
