"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthButton } from "./AuthButton";

const baseLinks = [
  { href: "/", label: "Scanner" },
  { href: "/launches", label: "Launches" },
  { href: "/signals", label: "Signals" },
  { href: "/whales", label: "Whales" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/orders", label: "Orders" },
  { href: "/wallet", label: "Wallet" },
  { href: "/account", label: "Account" },
];

export function Nav() {
  const path = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => setIsAdmin(Boolean(j.user?.isAdmin)))
      .catch(() => {});
  }, []);

  // The Admin link only appears for admins/owners. (Access is ALSO enforced
  // server-side on every /api/admin/* route, so hiding the link is just UX.)
  const links = isAdmin ? [...baseLinks, { href: "/admin", label: "Admin" }] : baseLinks;

  return (
    <header className="border-b border-edge bg-panel/60 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6 min-w-0">
          <Link href="/" className="font-bold tracking-tight text-white shrink-0">
            MemePump
          </Link>
          <nav className="flex gap-1 overflow-x-auto">
            {links.map((l) => {
              const active = path === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={
                    "px-3 py-1.5 rounded-md text-sm whitespace-nowrap " +
                    (active
                      ? "bg-white/10 text-white"
                      : "text-slate-400 hover:text-white hover:bg-white/5")
                  }
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <AuthButton />
      </div>
    </header>
  );
}
