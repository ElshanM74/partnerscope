/**
 * Password hashing via Node's built-in scrypt. No external deps.
 *
 * Stored format: `scrypt$N$salt_hex$hash_hex` — self-describing so we can
 * migrate to argon2id later without breaking existing hashes.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  pw: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64; // 512 bits
const SALTLEN = 16; // 128 bits
const COST_N = 16384; // Node's scrypt default; OWASP-acceptable floor for 2024

/** Hash a plaintext password. Returns `scrypt$<N>$<salt_hex>$<hash_hex>`. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALTLEN);
  const hash = await scryptAsync(plain, salt, KEYLEN);
  return `scrypt$${COST_N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * Constant-time verify. Returns `false` on any parse or length mismatch.
 * Callers should still invoke this on invalid-email paths with a dummy hash
 * to equalise response timing (see routes/auth.ts login handler).
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const [scheme, , saltHex, expectedHex] = parts as [string, string, string, string];
  if (scheme !== 'scrypt') return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length === 0) return false;
  try {
    const actual = await scryptAsync(plain, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
