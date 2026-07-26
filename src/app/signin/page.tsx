"use client";

// /signin — email code sign-in for admins.
//
// This is the "I'm on a different device / laptop / borrowed phone and my wallet
// is not here" path. It issues a normal session, so /admin works exactly as it
// does after a wallet login.
import { useState } from "react";
import { Badge, Button, Field, TextInput } from "@/components/ui";

type Step = "email" | "code";

export default function SignInPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/auth/email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not send the code.");
        return;
      }
      setNote(json.message ?? "Check your inbox for the code.");
      setStep("code");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not verify that code.");
        return;
      }
      // Full reload so server components pick up the new session cookie.
      window.location.href = "/admin";
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg py-8">
      <div className="mb-5">
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-xl font-bold text-ink">Sign in with email</h1>
          <Badge tone="accent">Admins</Badge>
        </div>
        <p className="text-sm text-mute">
          For signing in on a device that does not have your wallet. We email you a
          6-digit code — no password to remember, nothing to leak.
        </p>
      </div>

      {step === "email" ? (
        <div className="card p-4">
          <Field
            label="Admin email address"
            hint="Must match the email saved on your account under Account & alerts."
          >
            <TextInput
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <div className="mt-3">
            <Button
              variant="primary"
              onClick={sendCode}
              disabled={busy || email.trim().length < 5}
            >
              {busy ? "Sending…" : "Email me a code"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="card p-4">
          {note ? (
            <div className="mb-3 rounded-md border border-edge bg-panel2 p-2.5 text-xs text-mute">
              {note}
            </div>
          ) : null}
          <Field label="6-digit code" hint="Expires in 10 minutes. Single use.">
            <TextInput
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={verify}
              disabled={busy || code.length !== 6}
            >
              {busy ? "Checking…" : "Sign in"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              disabled={busy}
            >
              Use a different email
            </Button>
          </div>
        </div>
      )}

      {error ? (
        <div className="mt-3 rounded-md border border-down/40 bg-down/10 p-2.5 text-xs text-down">
          {error}
        </div>
      ) : null}

      <div className="mt-5 card p-4">
        <div className="mb-1.5 text-sm font-semibold text-ink">
          Set this up before you need it
        </div>
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-mute">
          <li>
            Email sign-in only works if your account already has an email saved and
            already holds the admin or owner role. Add it now in{" "}
            <a className="text-accent hover:underline" href="/account">
              Account &amp; alerts
            </a>
            .
          </li>
          <li>
            It also needs working SMTP settings in the admin panel — the same ones
            used for trade and price alerts. Send the test email once to confirm.
          </li>
          <li>
            Locked out completely, with no admin account reachable? Set{" "}
            <code>BOOTSTRAP_ADMIN_WALLET</code> in your host environment to a
            wallet you control and sign in with it, or promote a row directly in
            the <code>app_users</code> table. The old <code>/recover</code>
            shared-secret page was removed because a single reusable secret was
            too weak a key to the whole admin panel.
          </li>
        </ul>
      </div>
    </div>
  );
}
