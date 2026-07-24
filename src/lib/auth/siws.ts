// Sign-In-With-Solana: verify that a wallet controls its address by checking
// a signature over a server-issued nonce. No private key ever leaves the
// user's wallet. Real ed25519 verification via tweetnacl.
import nacl from "tweetnacl";
import bs58 from "bs58";
import { getServiceClient } from "../supabase";

export function buildSignInMessage(nonce: string): string {
  return (
    "MemePump wants you to sign in.\n\n" +
    "This request will not trigger a transaction or cost any fees.\n\n" +
    `Nonce: ${nonce}`
  );
}

/** Create + persist a one-time nonce. */
export async function issueNonce(): Promise<string> {
  const nonce = bs58.encode(nacl.randomBytes(16));
  const db = getServiceClient();
  if (db) {
    await db.from("auth_nonces").insert({ nonce });
  }
  return nonce;
}

/** Verify a signature over the message for the given nonce, then burn it. */
export async function verifySignature(
  walletAddress: string,
  nonce: string,
  signatureBase58: string,
): Promise<boolean> {
  const db = getServiceClient();
  if (db) {
    const { data } = await db
      .from("auth_nonces")
      .select("nonce, used")
      .eq("nonce", nonce)
      .maybeSingle();
    if (!data || data.used) return false;
  }

  const message = buildSignInMessage(nonce);
  let ok = false;
  try {
    ok = nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(signatureBase58),
      bs58.decode(walletAddress),
    );
  } catch {
    ok = false;
  }

  if (ok && db) {
    await db.from("auth_nonces").update({ used: true }).eq("nonce", nonce);
  }
  return ok;
}
