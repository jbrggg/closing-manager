import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// -----------------------------------------------------------------------------
// Symmetric encryption for secrets stored in the database (OAuth access and
// refresh tokens). AES-256-GCM gives us confidentiality plus an integrity
// tag, so tampering is detected rather than silently decrypting to garbage.
//
// The key comes from APP_ENCRYPTION_KEY. Generate one with:
//     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Losing this key means every stored token becomes undecryptable and each
// mailbox must be reconnected — it is not a throwaway value. Back it up
// wherever the agency keeps its other secrets.
// -----------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the standard size for GCM
const KEY_LENGTH = 32;

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set. Generate one with:\n" +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"\n` +
        "then add it to .env.local. Required before connecting a real mailbox."
    );
  }
  // Accept either a 32-byte base64 key or any passphrase (hashed to 32 bytes).
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === KEY_LENGTH) return decoded;
  return createHash("sha256").update(raw).digest();
}

/** Returns `ivBase64.ciphertextBase64.authTagBase64`. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), ciphertext.toString("base64"), authTag.toString("base64")].join(".");
}

export function decryptSecret(payload: string | null): string | null {
  if (!payload) return null;
  const parts = payload.split(".");
  if (parts.length !== 3) return null;
  try {
    const [ivB64, dataB64, tagB64] = parts;
    const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, tampered ciphertext, or corrupt row — all indistinguishable
    // on purpose. Caller treats null as "reconnect this mailbox".
    return null;
  }
}

export function isEncryptionConfigured(): boolean {
  return Boolean(process.env.APP_ENCRYPTION_KEY);
}
