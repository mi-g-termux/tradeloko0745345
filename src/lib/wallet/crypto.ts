// Encryption for custodial wallet secret keys.
//
// THREAT MODEL
// ------------
// The attacker we care about has a copy of the database (leak, backup, SQL
// injection). They must not be able to derive any signing key. A second, worse
// attacker also has the master key from the environment; against them we can
// only limit blast radius, not prevent loss — which is why the long-term answer
// is a KMS/HSM that never reveals key material to the app.
//
// TWO CIPHERTEXT VERSIONS
// -----------------------
// v1 (legacy): AES-256-GCM under a single global key derived as either a 64-hex
//   master key or a bare SHA-256 of a passphrase. Still readable so existing
//   wallets keep working, but never written again.
// v2 (current): AES-256-GCM under a key derived PER USER with HKDF-SHA256 from
//   the root key. Two properties this buys us:
//     - Compartmentalization: one recovered per-user key cannot decrypt anyone
//       else's wallet.
//     - Binding: a ciphertext moved to another user's row will not decrypt, so
//       swapping rows in the DB cannot redirect a signature.
//   Passphrase root keys go through scrypt instead of raw SHA-256, so a weak
//   passphrase is expensive rather than instant to brute force.
//
// Rows are upgraded v1 -> v2 lazily on first use (see custodial.getUserKeypair).
import crypto from "crypto";
import { SERVER_ENV } from "../config";

/** Domain separation for the v2 KDF. Changing these invalidates v2 rows. */
const HKDF_SALT = "memepump.wallet.hkdf.v2";
const SCRYPT_SALT = "memepump.wallet.scrypt.v2";
/** scrypt cost. N=2^15 is ~100ms server-side; unusable for mass brute force. */
const SCRYPT_N = 32768;

function isHexKey(raw: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(raw);
}

function rawKeyOrThrow(): string {
  const raw = SERVER_ENV.walletMasterKey;
  if (!raw) {
    throw new Error(
      "WALLET_MASTER_KEY is not set — custodial wallets are disabled.",
    );
  }
  return raw;
}

/** True when a master key is configured (custodial wallets can operate). */
export function walletCryptoReady(): boolean {
  return Boolean(SERVER_ENV.walletMasterKey);
}

/**
 * Report master key quality so the admin panel can warn instead of silently
 * running on a guessable key. Never returns the key itself.
 */
export function masterKeyStrength(): {
  configured: boolean;
  strong: boolean;
  reason: string;
} {
  const raw = SERVER_ENV.walletMasterKey;
  if (!raw) {
    return {
      configured: false,
      strong: false,
      reason: "WALLET_MASTER_KEY is not set. Custodial wallets are disabled.",
    };
  }
  if (isHexKey(raw)) {
    return {
      configured: true,
      strong: true,
      reason: "64-character hex key (256-bit). This is the recommended form.",
    };
  }
  return {
    configured: true,
    strong: false,
    reason:
      "Master key is a passphrase, not a 64-character hex key. It is stretched with scrypt, " +
      "but a guessable passphrase is still the weakest link. Generate a real key with " +
      "`openssl rand -hex 32`, then migrate wallets before switching.",
  };
}

// ---- v1 (legacy, read-only) ----

let legacyCache: Buffer | null = null;

function legacyKey(): Buffer {
  if (legacyCache) return legacyCache;
  const raw = rawKeyOrThrow();
  legacyCache = isHexKey(raw)
    ? Buffer.from(raw, "hex")
    : crypto.createHash("sha256").update(raw).digest();
  return legacyCache;
}

// ---- v2 (current) ----

let rootCache: Buffer | null = null;

/** Root key material. scrypt-stretched when the env value is a passphrase. */
function rootKey(): Buffer {
  if (rootCache) return rootCache;
  const raw = rawKeyOrThrow();
  if (isHexKey(raw)) {
    rootCache = Buffer.from(raw, "hex");
  } else {
    // Cached because scrypt is deliberately slow.
    rootCache = crypto.scryptSync(raw, SCRYPT_SALT, 32, {
      N: SCRYPT_N,
      r: 8,
      p: 1,
      // scrypt needs memory proportional to N; raise the default cap.
      maxmem: 128 * SCRYPT_N * 8 * 2,
    });
  }
  return rootCache;
}

const userKeyCache = new Map<string, Buffer>();

/** Per-user 256-bit key: HKDF-SHA256(rootKey, salt, info = ownerId). */
function userKey(ownerId: string): Buffer {
  if (!ownerId) throw new Error("ownerId is required to derive a wallet key.");
  const hit = userKeyCache.get(ownerId);
  if (hit) return hit;
  const derived = Buffer.from(
    crypto.hkdfSync("sha256", rootKey(), HKDF_SALT, ownerId, 32),
  );
  userKeyCache.set(ownerId, derived);
  return derived;
}

/** Encrypt a raw secret key -> "v2.<iv>.<tag>.<ciphertext>" (base64 parts). */
export function encryptSecret(secret: Uint8Array, ownerId: string): string {
  const key = userKey(ownerId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v2",
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

/** True when a stored ciphertext is still on the legacy global key. */
export function needsUpgrade(enc: string): boolean {
  return enc.startsWith("v1.");
}

/** Decrypt a stored ciphertext (either version) into raw secret key bytes. */
export function decryptSecret(enc: string, ownerId: string): Uint8Array {
  const parts = enc.split(".");
  if (parts.length !== 4 || (parts[0] !== "v1" && parts[0] !== "v2")) {
    throw new Error("Corrupt or unsupported wallet ciphertext.");
  }
  const key = parts[0] === "v1" ? legacyKey() : userKey(ownerId);
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(out);
}
