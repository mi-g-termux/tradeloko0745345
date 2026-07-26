"use client";
import { useEffect, useState } from "react";
import bs58 from "bs58";
import { ShieldCheck, Wallet } from "lucide-react";
import { shortAddr } from "@/lib/format";

interface Me {
  id: string;
  walletAddress: string | null;
  telegramUsername: string | null;
  displayName: string | null;
  isAdmin: boolean;
}

// Minimal typing for an injected Solana wallet (Phantom/Solflare).
type SolanaProvider = {
  publicKey?: { toBase58(): string };
  connect: () => Promise<{ publicKey: { toBase58(): string } }>;
  signMessage: (msg: Uint8Array, enc?: string) => Promise<{ signature: Uint8Array }>;
};

function getProvider(): SolanaProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { solana?: SolanaProvider };
  return w.solana ?? null;
}

export function AuthButton() {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/auth/me");
    const j = await r.json();
    setMe(j.user);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function loginWallet() {
    setErr(null);
    setBusy(true);
    try {
      const provider = getProvider();
      if (!provider) throw new Error("No Solana wallet found. Install Phantom.");
      const { publicKey } = await provider.connect();
      const address = publicKey.toBase58();
      const nonceRes = await fetch("/api/auth/nonce").then((r) => r.json());
      const nonce = nonceRes.nonce as string;
      const message =
        "MemePump wants you to sign in.\n\n" +
        "This request will not trigger a transaction or cost any fees.\n\n" +
        `Nonce: ${nonce}`;
      const enc = new TextEncoder().encode(message);
      const signed = await provider.signMessage(enc, "utf8");
      const signature = bs58.encode(signed.signature);
      const res = await fetch("/api/auth/siws", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address, nonce, signature }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Login failed");
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
  }

  if (me) {
    const label = me.walletAddress
      ? shortAddr(me.walletAddress)
      : me.telegramUsername
        ? "@" + me.telegramUsername
        : "Account";
    return (
      <div className="flex items-center gap-2 text-sm">
        {me.isAdmin && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 text-xs">
            <ShieldCheck size={12} /> admin
          </span>
        )}
        <span className="text-slate-300 font-mono">{label}</span>
        <button onClick={logout} className="text-slate-400 hover:text-white">
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-red-400 text-xs max-w-[200px] truncate">{err}</span>}
      <button
        onClick={loginWallet}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
      >
        <Wallet size={15} />
        {busy ? "Connecting…" : "Connect Wallet"}
      </button>
      {/* No email link here on purpose. Email sign-in is an admin-only escape
          hatch, and advertising it to every visitor both confuses regular users
          (who cannot use it) and points attackers at the admin door. Admins
          reach it directly at /signin. */}
    </div>
  );
}
