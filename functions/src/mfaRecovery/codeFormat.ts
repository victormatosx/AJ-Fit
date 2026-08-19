import { RecoveryError } from './errors';

/**
 * MFA Recovery — recovery code format contract.
 *
 * PHASE 1 SCOPE: shape, parsing and canonicalization only. There is NO
 * generator here. Nothing in this module produces a usable code, so nothing
 * in this module can hand a user a credential.
 *
 *
 * THE FORMAT
 * ----------
 *     AJF-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
 *     ^^^ ^^^^^^^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *     |   selector       secret
 *     prefix
 *
 *   - `AJF`     fixed prefix. Not secret. Lets support and the client
 *               recognize the artifact, and lets us reject a TOTP code or a
 *               promo code pasted into the wrong field before any lookup.
 *   - selector  12 symbols. NOT SECRET. This is the lookup key: it is the
 *               Firestore document id of the recovery set. It exists so the
 *               backend can find the set FROM THE CODE ALONE — the client
 *               never sends an email or a uid to the recovery endpoint, which
 *               is what keeps that endpoint from becoming an account-
 *               enumeration oracle.
 *   - secret    28 symbols. THE actual secret. Only this part carries the
 *               security claim; it is what the HMAC is computed over
 *               (together with the selector, for domain binding — see
 *               digest.ts).
 *
 * Hyphen grouping is DISPLAY ONLY. It carries no meaning, is stripped during
 * normalization, and the selector/secret boundary deliberately falls on a
 * group boundary (3 groups of selector, 7 of secret) purely so the layout
 * reads cleanly.
 *
 *
 * ALPHABET — Crockford Base32
 * ---------------------------
 * `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — 32 symbols, with `I`, `L`, `O` and `U`
 * removed. `I`/`L` are dropped because they collide with `1`, `O` because it
 * collides with `0`, and `U` because excluding it prevents accidental
 * obscenities in generated codes.
 *
 * 32 symbols is exactly 2^5, so every symbol carries exactly 5 bits with no
 * modulo bias when sampled from a CSPRNG (Phase 2 must sample by rejecting
 * out-of-range bytes, never by `% 32`).
 *
 *
 * ENTROPY CALCULATION
 * -------------------
 *   bits per symbol   = log2(32)            = 5 bits exactly
 *   secret            = 28 symbols x 5 bits = 140 bits
 *   selector          = 12 symbols x 5 bits =  60 bits   (lookup key, NOT
 *                                                         counted as secret)
 *
 *   EFFECTIVE SECRET ENTROPY = 140 bits  >=  128 bit target.   OK
 *   Margin over target: 12 bits (a factor of 4096).
 *
 * Why the selector is excluded from the claim: it is stored in plaintext as
 * the document id and is therefore assumed known to anyone who has read the
 * database. The security of a code must survive that assumption, so only the
 * 140-bit secret half counts.
 *
 * Confusable aliasing (below) does NOT reduce entropy. Aliases are never
 * GENERATED — the generator draws only from the 32-symbol alphabet, so the
 * generated space stays 32^28 = 2^140. Aliasing only widens the set of typed
 * INPUTS that canonicalize onto that same space.
 *
 * Offline resistance: with the pepper intact, recovering a code from a stolen
 * digest costs 2^140 HMAC-SHA-256 evaluations. Online guessing is bounded by
 * rate limiting (RecoveryRateLimitState), not by entropy.
 *
 *
 * SELECTOR COLLISIONS
 * -------------------
 * 60 bits = 1.1529e18 possible selectors. At an assumed ceiling of 1e6 active
 * recovery sets, the expected number of colliding pairs is
 *
 *     n^2 / (2 * 2^60)  =  1e12 / 2.3058e18  ~=  4.3e-7
 *
 * i.e. operationally impossible even with a large safety factor on the user
 * count. The selector was widened from 8 symbols (40 bits) to 12 precisely to
 * retire this concern: at 40 bits the same calculation gave ~0.45 expected
 * colliding pairs, which is a real event rather than a rounding error.
 *
 * Phase 2 must STILL create the set with Firestore's must-not-exist
 * precondition (`DocumentReference.create()`, the same technique
 * vaultRepository.ts uses) and regenerate the selector on ALREADY_EXISTS.
 * That is no longer about expected collisions — it is about never letting a
 * CSPRNG fault, a truncated read or a duplicated request silently overwrite
 * somebody's live recovery set. Lookup stays an O(1) `.doc(selector).get()`
 * with no index and no query.
 *
 *
 * DELIBERATELY OMITTED
 * --------------------
 * No checksum digit. It would let us reject typos without a database lookup,
 * but it also spends entropy budget and adds a second normalization rule that
 * must never "helpfully" repair a code into a DIFFERENT valid code. Revisit in
 * Phase 2 only if the extra round trip proves to be a real UX problem.
 */

/** Fixed, non-secret product prefix. */
export const RECOVERY_CODE_PREFIX = 'AJF' as const;

/** Crockford Base32: no I, L, O or U. */
export const RECOVERY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' as const;

/** log2(32). Exact, because the alphabet size is a power of two. */
export const RECOVERY_CODE_BITS_PER_SYMBOL = 5;

/** Symbols in the non-secret lookup half. 12 => 60 bits of selector space. */
export const RECOVERY_CODE_SELECTOR_LENGTH = 12;

/** Symbols in the secret half. */
export const RECOVERY_CODE_SECRET_LENGTH = 28;

/** Symbols after the prefix: selector + secret. */
export const RECOVERY_CODE_PAYLOAD_LENGTH =
  RECOVERY_CODE_SELECTOR_LENGTH + RECOVERY_CODE_SECRET_LENGTH;

/** Display grouping size. Cosmetic only — stripped before any comparison. */
export const RECOVERY_CODE_GROUP_SIZE = 4;

/** 60 bits. Lookup key; explicitly NOT part of the security claim. */
export const RECOVERY_CODE_SELECTOR_BITS =
  RECOVERY_CODE_SELECTOR_LENGTH * RECOVERY_CODE_BITS_PER_SYMBOL;

/** 140 bits. The number the >= 128 bit requirement is measured against. */
export const RECOVERY_CODE_SECRET_BITS =
  RECOVERY_CODE_SECRET_LENGTH * RECOVERY_CODE_BITS_PER_SYMBOL;

/** The bar Phase 1 was required to clear. */
export const RECOVERY_CODE_MIN_SECRET_BITS = 128;

/** Canonical length: prefix + payload, no separators. */
export const RECOVERY_CODE_CANONICAL_LENGTH =
  RECOVERY_CODE_PREFIX.length + RECOVERY_CODE_PAYLOAD_LENGTH;

/**
 * Defensive input ceiling, applied before any other work.
 *
 * Generous enough for the fully-grouped form plus stray whitespace, small
 * enough that no pathological input reaches the character loop.
 */
const MAX_RAW_INPUT_LENGTH = 128;

/**
 * Confusable aliases accepted on INPUT only.
 *
 * These four symbols are excluded from the alphabet, so no generated code can
 * ever contain them. That is precisely what makes the mapping safe: it can
 * only ever turn a mistyped character into the one the user meant, and can
 * never turn valid code A into a different valid code B.
 *
 * `U` has no unambiguous numeric or alphabetic counterpart, so it is NOT
 * aliased — it is simply rejected. Guessing between `U` and `V` would be the
 * kind of silent, dangerous repair this contract forbids.
 */
const CONFUSABLE_ALIASES: Readonly<Record<string, string>> = {
  I: '1',
  L: '1',
  O: '0',
};

const ALPHABET_SET: ReadonlySet<string> = new Set(RECOVERY_CODE_ALPHABET);

export interface ParsedRecoveryCode {
  /** Prefix + payload, uppercase, no separators. The exact HMAC input. */
  canonical: string;
  /** 12 symbols. Firestore document id of the recovery set. Not secret. */
  selector: string;
  /** 28 symbols. The secret half. Never logged, never persisted. */
  secret: string;
}

/**
 * Canonicalizes and validates a user-typed recovery code.
 *
 * Deterministic and total: the same input always yields the same canonical
 * form, and anything that is not structurally a recovery code throws
 * `MALFORMED_CODE` rather than being coerced into one.
 *
 * Accepted variations, all of which collapse to the same canonical string:
 * lowercase, missing or extra hyphens, surrounding or interior whitespace,
 * and the confusable aliases above.
 *
 * NOT accepted, on purpose: a wrong prefix, a wrong length, or any symbol
 * outside the alphabet once aliases are applied. No truncation, no padding,
 * no nearest-match repair.
 */
export function parseRecoveryCode(raw: unknown): ParsedRecoveryCode {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RAW_INPUT_LENGTH) {
    throw new RecoveryError('MALFORMED_CODE');
  }

  // Strip separators and case first; alias mapping then runs over a string
  // that contains only the characters the user actually intended to type.
  const stripped = raw.replace(/[\s-]/g, '').toUpperCase();

  if (stripped.length !== RECOVERY_CODE_CANONICAL_LENGTH) {
    throw new RecoveryError('MALFORMED_CODE');
  }
  if (!stripped.startsWith(RECOVERY_CODE_PREFIX)) {
    throw new RecoveryError('MALFORMED_CODE');
  }

  const rawPayload = stripped.slice(RECOVERY_CODE_PREFIX.length);

  let payload = '';
  for (const character of rawPayload) {
    const normalized = CONFUSABLE_ALIASES[character] ?? character;
    if (!ALPHABET_SET.has(normalized)) {
      throw new RecoveryError('MALFORMED_CODE');
    }
    payload += normalized;
  }

  return {
    canonical: `${RECOVERY_CODE_PREFIX}${payload}`,
    selector: payload.slice(0, RECOVERY_CODE_SELECTOR_LENGTH),
    secret: payload.slice(RECOVERY_CODE_SELECTOR_LENGTH),
  };
}

/** Canonical string only, for the common case of hashing a typed code. */
export function normalizeRecoveryCode(raw: unknown): string {
  return parseRecoveryCode(raw).canonical;
}

/** True when `raw` parses; never throws. */
export function isWellFormedRecoveryCode(raw: unknown): boolean {
  try {
    parseRecoveryCode(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Renders a canonical code in the grouped display form.
 *
 * Presentation only — Phase 3 will use this exactly once, on the one-time
 * reveal screen. It is never used for comparison or storage.
 */
export function formatRecoveryCodeForDisplay(canonical: string): string {
  const { canonical: verified } = parseRecoveryCode(canonical);
  const payload = verified.slice(RECOVERY_CODE_PREFIX.length);

  const groups: string[] = [];
  for (let index = 0; index < payload.length; index += RECOVERY_CODE_GROUP_SIZE) {
    groups.push(payload.slice(index, index + RECOVERY_CODE_GROUP_SIZE));
  }

  return [RECOVERY_CODE_PREFIX, ...groups].join('-');
}
