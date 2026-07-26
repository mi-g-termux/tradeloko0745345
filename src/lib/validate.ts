// Request body validation.
//
// Routes used to hand-parse `body.foo` with String()/Number() coercion, which
// silently accepted wrong types and passed them to the database layer. These
// helpers give each endpoint one explicit schema and one consistent 400.
import { NextResponse } from "next/server";
import { z } from "zod";

export { z };

export type Parsed<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

function firstMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid request body.";
  const path = issue.path.join(".");
  return path ? path + ": " + issue.message : issue.message;
}

/**
 * Parse and validate a JSON request body. Returns a discriminated result rather
 * than throwing, so routes stay flat:
 *   const parsed = await parseBody(req, Schema);
 *   if (!parsed.ok) return parsed.response;
 */
export async function parseBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<Parsed<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      ),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: firstMessage(result.error) },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: result.data };
}

/** Solana address: base58, 32-44 chars. Rejects lookalike characters. */
export const solanaAddress = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Not a valid Solana address.");

export const emailAddress = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(320);

export const otpCode = z
  .string()
  .transform((s) => s.replace(/\D/g, ""))
  .refine((s) => s.length === 6, "Enter the 6-digit code.");

/** SOL amount: positive, finite, capped to stop fat-finger transfers. */
export const solAmount = z
  .number()
  .finite("Amount must be a number.")
  .positive("Amount must be greater than 0.")
  .max(100000, "Amount is unreasonably large.");

export const percent = z.number().finite().min(0).max(100);
