import { randomBytes } from 'node:crypto';

import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_PREFIX,
  RECOVERY_CODE_SECRET_LENGTH,
  RECOVERY_CODE_SELECTOR_LENGTH,
  parseRecoveryCode,
} from './codeFormat';
import { RECOVERY_CODES_PER_SET } from './schema';

/**
 * MFA Recovery — the only place recovery code symbols are ever produced.
 *
 *
 * WHY MASKING THE LOW 5 BITS IS UNBIASED (AND WHY THERE IS NO REJECTION LOOP)
 * --------------------------------------------------------------------------
 * The alphabet has exactly 32 symbols and 32 = 2^5 divides 256 evenly. Each
 * of the 256 possible byte values therefore maps to exactly 8 of the 32
 * symbols' preimages — 256 / 32 = 8, with no remainder and no leftover range.
 * Taking `byte & 0x1F` is literally "read 5 raw bits from the CSPRNG", so the
 * output distribution is exactly the input distribution restricted to 5 bits:
 * uniform.
 *
 * This is the reason no rejection sampling is needed here. Rejection sampling
 * exists to fix the case where the alphabet size does NOT divide the byte
 * range (e.g. 10 digits out of 256: values 250-255 would make 0-5 more likely
 * than 6-9). That failure mode cannot arise for a power-of-two alphabet.
 *
 * Masking is preferred over `% 32` even though the two are arithmetically
 * identical for a power-of-two modulus: `& 0x1F` states "these are 5 bits"
 * directly, so the uniformity argument is visible in the code rather than
 * depending on the reader knowing that 32 happens to divide 256. A test
 * enumerates all 256 byte values and asserts each symbol is hit exactly 8
 * times, so the property is checked rather than asserted in prose.
 *
 * `randomBytes` is Node's CSPRNG. Never `Math.random`, never a UUID slice,
 * never a timestamp, never anything derived from the uid, email or a token.
 *
 *
 * SCOPE: pure generation. Nothing here hashes, persists, logs or returns a
 * code to anyone — the caller owns the plaintext's short life.
 */

/** 0b11111 — the low 5 bits of a byte, i.e. one alphabet index. */
const SYMBOL_MASK = 0x1f;

/**
 * Defensive ceiling on regeneration attempts when a duplicate secret appears
 * within one set.
 *
 * A collision between two 140-bit secrets is not going to happen (the
 * birthday probability across 10 codes is ~2.6e-40); this bound exists so a
 * broken or stubbed CSPRNG produces a loud failure instead of an infinite
 * loop.
 */
const MAX_UNIQUENESS_ATTEMPTS = 100;

/** Raised when generation cannot make progress — always a bug or a broken RNG. */
export class RecoveryGenerationError extends Error {
  constructor(detail: string) {
    super(`RECOVERY_GENERATION_FAILED: ${detail}`);
    this.name = 'RecoveryGenerationError';
  }
}

/**
 * Draws `count` uniformly random symbols from the Crockford Base32 alphabet.
 *
 * One CSPRNG call per invocation rather than one per symbol: fewer syscalls,
 * and the whole draw comes from a single entropy request.
 */
export function randomRecoverySymbols(count: number): string {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RecoveryGenerationError('symbol count must be a positive integer');
  }

  const bytes = randomBytes(count);
  let symbols = '';

  for (let index = 0; index < count; index += 1) {
    symbols += RECOVERY_CODE_ALPHABET[bytes[index] & SYMBOL_MASK];
  }

  return symbols;
}

/**
 * A fresh 12-symbol (60-bit) recovery set selector.
 *
 * Purely random. It carries no uid, no email, no timestamp and no account
 * information of any kind — it is an opaque lookup key that also happens to
 * be safe to use as a Firestore document id.
 */
export function generateRecoverySelector(): string {
  return randomRecoverySymbols(RECOVERY_CODE_SELECTOR_LENGTH);
}

/** A fresh 28-symbol (140-bit) secret half. */
export function generateRecoverySecret(): string {
  return randomRecoverySymbols(RECOVERY_CODE_SECRET_LENGTH);
}

/**
 * Assembles one canonical recovery code for a given selector.
 *
 * Round-trips through `parseRecoveryCode` rather than trusting the
 * concatenation: that is the Phase 1 parser, so a generator that ever drifted
 * from the declared format (wrong length, stray symbol) would fail here
 * instead of minting a code the verifier cannot read back.
 */
export function generateRecoveryCode(selector: string): string {
  const candidate = `${RECOVERY_CODE_PREFIX}${selector}${generateRecoverySecret()}`;
  const { canonical, selector: parsedSelector } = parseRecoveryCode(candidate);

  if (parsedSelector !== selector) {
    throw new RecoveryGenerationError('generated code does not carry the requested selector');
  }

  return canonical;
}

export interface GeneratedRecoveryCodeSet {
  /** 12 symbols. Becomes `recoverySetId` and the Firestore document id. */
  selector: string;
  /** Canonical plaintext codes. NEVER persisted, NEVER logged. */
  codes: string[];
}

/**
 * Generates a complete, internally-unique set of recovery codes.
 *
 * All codes in a set share one selector (that is what makes a single
 * `.doc(selector).get()` able to find the set from any of its codes) and
 * differ only in their secret half.
 *
 * Uniqueness is ENFORCED, not assumed. Two identical codes in a set would
 * mean one plaintext opens two records, silently shrinking the set — so a
 * duplicate secret is regenerated rather than accepted. In practice this loop
 * never runs twice; it exists so that a stubbed or degraded RNG surfaces as a
 * thrown error instead of a quietly weakened set.
 *
 * @param count how many codes to mint. Fixed by the caller from
 *              `RECOVERY_CODES_PER_SET`; never taken from client input.
 */
export function generateRecoveryCodeSet(
  count: number = RECOVERY_CODES_PER_SET,
): GeneratedRecoveryCodeSet {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RecoveryGenerationError('code count must be a positive integer');
  }

  const selector = generateRecoverySelector();
  const codes = new Set<string>();

  let attempts = 0;
  while (codes.size < count) {
    if (attempts >= MAX_UNIQUENESS_ATTEMPTS) {
      throw new RecoveryGenerationError('exceeded unique code generation attempts');
    }
    attempts += 1;
    codes.add(generateRecoveryCode(selector));
  }

  return { selector, codes: [...codes] };
}
