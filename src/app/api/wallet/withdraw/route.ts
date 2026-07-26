// POST /api/wallet/withdraw  { to, amountSol, code? }
//
// Layers, in order, before anything is signed:
//   1. session check      - who is asking
//   2. rate limit         - stops rapid-fire draining attempts
//   3. schema validation  - real base58 address, sane amount
//   4. spending guards    - per-transfer cap, 24h cap, allowlist
//   5. email confirmation - optional second factor bound to this exact transfer
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { checkRateLimit, tooManyRequests } from "@/lib/security/rateLimit";
import { assertWithdrawAllowed } from "@/lib/wallet/guards";
import { withdrawSol } from "@/lib/wallet/custodial";
import {
  consumeWithdrawConfirmation,
  requestWithdrawConfirmation,
} from "@/lib/wallet/withdrawConfirm";
import { parseBody, solAmount, solanaAddress, z } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WithdrawSchema = z.object({
  to: solanaAddress,
  amountSol: solAmount,
  /** Emailed confirmation code, when the account requires one. */
  code: z.string().trim().min(1).max(12).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const limit = await checkRateLimit({
    bucket: "wallet_withdraw",
    identifier: user.id,
    limit: 10,
    windowSec: 3600,
  });
  if (!limit.allowed) {
    return tooManyRequests(
      limit,
      "Too many withdrawal attempts in the last hour. Try again later.",
    );
  }

  const parsed = await parseBody(req, WithdrawSchema);
  if (!parsed.ok) return parsed.response;
  const { to, amountSol, code } = parsed.data;

  try {
    const { limits } = await assertWithdrawAllowed(user.id, to, amountSol);

    if (limits.withdrawConfirmRequired) {
      if (!code) {
        // 202: understood, but held pending the emailed code.
        const outcome = await requestWithdrawConfirmation(user.id, to, amountSol);
        if (!outcome.ok) {
          return NextResponse.json({ error: outcome.error }, { status: 400 });
        }
        return NextResponse.json(
          {
            ok: false,
            confirmationRequired: true,
            expiresInMinutes: outcome.expiresInMinutes,
            message:
              "We emailed a confirmation code. Re-submit this withdrawal with the code to complete it.",
          },
          { status: 202 },
        );
      }
      const good = await consumeWithdrawConfirmation(user.id, to, amountSol, code);
      if (!good) {
        return NextResponse.json(
          {
            error:
              "That confirmation code is wrong, expired, already used, or does not match this exact amount and destination.",
          },
          { status: 401 },
        );
      }
    }

    const { signature } = await withdrawSol(user.id, to, amountSol);
    return NextResponse.json({ ok: true, signature });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
