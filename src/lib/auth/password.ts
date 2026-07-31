import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

// scrypt parameters. N=2^15 is a reasonable interactive-login cost — high
// enough to be expensive to brute-force, low enough not to stall a request.
// Raise N if login latency budget allows; the stored format records the
// parameters used, so existing hashes keep verifying after a change.
// maxmem must exceed roughly 128 * N * r bytes (~32 MB here); Node's
// default cap is 32 MB, which this would otherwise trip.
const MAXMEM = 96 * 1024 * 1024;
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: MAXMEM };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Produces `scrypt$N$r$p$saltHex$keyHex`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Timing-safe verification. Returns false rather than throwing on a
 * malformed stored hash, so a corrupt row can't be distinguished from a
 * wrong password by response timing or error shape.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltHex, keyHex] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(keyHex, "hex");
    const actual = await scrypt(password, salt, expected.length, { N, r, p, maxmem: MAXMEM });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Minimum password policy for this prototype. Deliberately simple: length is
 * the property that actually matters most, and complexity rules tend to
 * push people toward predictable substitutions. Tighten per the agency's own
 * policy before real deployment.
 */
export function validatePasswordStrength(password: string): { ok: boolean; message?: string } {
  if (password.length < 12) {
    return { ok: false, message: "Password must be at least 12 characters." };
  }
  return { ok: true };
}
