import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseRecoveryCode } from './codeFormat';
import { RecoveryError } from './errors';

/**
 * MFA Recovery — keyed digest contract for recovery codes.
 *
 * WHY HMAC WITH A PEPPER, NOT bcrypt/scrypt/argon2
 * ------------------------------------------------
 * Password hashes are deliberately slow because passwords are low-entropy and
 * must survive an offline attack on their own. A recovery code is not a
 * password: it carries 140 bits of CSPRNG entropy (see codeFormat.ts), so
 * brute force is already impossible at 2^140 regardless of how fast the hash
 * is. What we actually need is (a) a fast, constant-cost verification and
 * (b) protection against a database-only compromise. A keyed HMAC gives both:
 * without the pepper, a stolen digest is unusable, and a stolen digest plus
 * the pepper still costs 2^140.
 *
 * The pepper lives in Secret Manager and is bound to the recovery callable in
 * a LATER phase. It is NOT bound, read or defaulted here.
 *
 *
 * PHASE 1 SCOPE
 * -------------
 * These are pure functions. The pepper is an explicit PARAMETER — there is no
 * `process.env` read, no `defineSecret`, no default and no fallback anywhere
 * in this module. That is deliberate: it means Phase 1 cannot compute a real
 * digest even by accident, because no real pepper exists to pass in yet, and
 * it keeps the functions trivially testable with a throwaway key.
 *
 *
 * WHAT IS HASHED
 * --------------
 * The CANONICAL code, prefix and selector included, under a domain-separation
 * label. Including the selector binds a code to its own recovery set: a digest
 * lifted out of one set cannot be replayed against another, even in the
 * (retry-handled) event of a selector collision. The domain label ensures
 * these digests can never collide with any other HMAC the backend computes
 * with a different key for a different purpose.
 *
 * The plaintext code is never persisted, never logged and never returned. It
 * exists only as a function argument.
 */

/** Format version of the digest itself. Bump if the input or algorithm changes. */
export const RECOVERY_DIGEST_VERSION = 1;

/** The only algorithm accepted. Stored on the set so a future migration can branch. */
export const RECOVERY_DIGEST_ALGORITHM = 'HMAC-SHA-256' as const;

/** SHA-256 output width. */
export const RECOVERY_DIGEST_BYTES = 32;

/** Base64 length of a 32-byte digest, including the single `=` pad. */
export const RECOVERY_DIGEST_BASE64_LENGTH = 44;

/**
 * Minimum accepted pepper length.
 *
 * HMAC-SHA-256 keys longer than the 64-byte block are pre-hashed, and keys
 * shorter than the output add nothing, so 32 bytes is the point where the key
 * stops being the weak link.
 */
export const RECOVERY_PEPPER_MIN_BYTES = 32;

/**
 * Domain separation label. Versioned alongside RECOVERY_DIGEST_VERSION so a
 * future format change produces provably disjoint digests.
 */
const DIGEST_DOMAIN = 'ajfit.mfa-recovery.v1';

function assertUsablePepper(pepper: Uint8Array): void {
  if (!(pepper instanceof Uint8Array) || pepper.length < RECOVERY_PEPPER_MIN_BYTES) {
    // Length is shape information, not key material, but it is still not worth
    // stating: RecoveryError carries no detail slot by design.
    throw new RecoveryError('PEPPER_UNAVAILABLE');
  }
}

/**
 * Computes the stored digest for a recovery code.
 *
 * @param rawCode  a user-typed or freshly generated code, in any accepted
 *                 form; it is canonicalized here so that display grouping and
 *                 casing can never produce two different digests for one code.
 * @param pepper   the Secret Manager pepper, raw bytes. Supplied by the
 *                 caller; never sourced inside this module.
 * @returns        base64 of the 32-byte HMAC — exactly what
 *                 `RecoveryCodeRecord.digest` holds.
 */
export function computeRecoveryCodeDigest(rawCode: unknown, pepper: Uint8Array): string {
  assertUsablePepper(pepper);

  // Throws MALFORMED_CODE for anything that is not a recovery code, so a
  // digest can never be computed over unvalidated input.
  const { canonical } = parseRecoveryCode(rawCode);

  return createHmac('sha256', pepper)
    .update(`${DIGEST_DOMAIN}:${canonical}`, 'utf8')
    .digest('base64');
}

/**
 * Constant-time digest comparison.
 *
 * Verification walks the codes of a recovery set looking for a match, so a
 * byte-wise early exit would leak how much of a digest an attacker got right.
 * `timingSafeEqual` requires equal lengths, so mismatched or malformed input
 * returns false rather than throwing — a length difference is not secret (the
 * digest width is a published constant) and callers must not have to
 * distinguish "wrong" from "corrupt" at this layer.
 */
export function recoveryDigestsMatch(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const left = Buffer.from(a, 'base64');
  const right = Buffer.from(b, 'base64');

  if (
    left.length !== RECOVERY_DIGEST_BYTES ||
    right.length !== RECOVERY_DIGEST_BYTES
  ) {
    return false;
  }

  return timingSafeEqual(left, right);
}

/** Structural check for a persisted digest field. No key material involved. */
export function isWellFormedRecoveryDigest(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === RECOVERY_DIGEST_BASE64_LENGTH &&
    Buffer.from(value, 'base64').length === RECOVERY_DIGEST_BYTES &&
    Buffer.from(value, 'base64').toString('base64') === value
  );
}
