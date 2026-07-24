// Encryption for custodial wallet secret keys.
// Each user's Solana secret key is encrypted at rest with AES-256-GCM using a
// server-only master key (WALLET_MASTER_KEY). The plaintext secret key NEVER
// leaves the server and is never stored unencrypted.
//
// SECURITY: WALLET_MASTER_KEY must be a strong secret set only in the server
// environment. If it is lost, every custodial wallet becomes unrecoverable. If
// it leaks, an attacker who also has DB access can drain wallets. Treat it like
// a production signing key. Ideally set a 64-char hex string (32 bytes).
import crypto from "crypto";
import { SERVER_ENV } from "../config";

function masterKey(): Buffer {
  const raw = SERVER_ENV.walletMasterKey;
  if (!raw) {
    throw new Error(
      "WALLET_MASTER_KEY is not set — custodial wallets are disabled.",
    );
  }
  // Accept a 64-char hex key directly; otherwise derive 32 bytes from the string.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

/** True when a master key is configured (custodial wallets can operate). */
export function walletCryptoReady(): boolean {
  return Boolean(SERVER_ENV.walletMasterKey);
}

/** Encrypt a raw secret key -> "v1.<iv>.<tag>.<ciphertext>" (all base64). */
export function encryptSecret(secret: Uint8Array): string {
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

/** Decrypt a stored ciphertext back into the raw secret key bytes. */
export function decryptSecret(enc: string): Uint8Array {
  const key = masterKey();
  const parts = enc.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Corrupt or unsupported wallet ciphertext.");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(out);
}
