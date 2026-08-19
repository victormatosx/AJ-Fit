import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { RECOVERY_CODE_PREFIX, formatRecoveryCodeForDisplay } from '../codeFormat';
import {
  RECOVERY_DIGEST_ALGORITHM,
  RECOVERY_DIGEST_BASE64_LENGTH,
  RECOVERY_DIGEST_BYTES,
  RECOVERY_DIGEST_VERSION,
  RECOVERY_PEPPER_MIN_BYTES,
  computeRecoveryCodeDigest,
  isWellFormedRecoveryDigest,
  recoveryDigestsMatch,
} from '../digest';
import { RecoveryError } from '../errors';

const SELECTOR = '2W7K9XQF3MTB';
const SECRET = 'GHJKMNPQRSTVWXYZ0123456789AB';
const CODE_A = `${RECOVERY_CODE_PREFIX}${SELECTOR}${SECRET}`;
const CODE_B = `${RECOVERY_CODE_PREFIX}${SELECTOR}${SECRET.slice(0, -1)}C`;
/** Same secret half, different selector — must still digest differently. */
const CODE_C = `${RECOVERY_CODE_PREFIX}3W7K9XQF3MTB${SECRET}`;

/** Test-only peppers. No real pepper exists in Phase 1; none is read here. */
const PEPPER_ONE = Buffer.alloc(RECOVERY_PEPPER_MIN_BYTES, 0x11);
const PEPPER_TWO = Buffer.alloc(RECOVERY_PEPPER_MIN_BYTES, 0x22);

describe('recovery digest — determinism', () => {
  it('produces the same digest for the same code and pepper', () => {
    expect(computeRecoveryCodeDigest(CODE_A, PEPPER_ONE)).toBe(
      computeRecoveryCodeDigest(CODE_A, PEPPER_ONE),
    );
  });

  it('produces the same digest for every accepted input form of one code', () => {
    const canonical = computeRecoveryCodeDigest(CODE_A, PEPPER_ONE);

    expect(computeRecoveryCodeDigest(CODE_A.toLowerCase(), PEPPER_ONE)).toBe(canonical);
    expect(computeRecoveryCodeDigest(formatRecoveryCodeForDisplay(CODE_A), PEPPER_ONE)).toBe(
      canonical,
    );
    expect(computeRecoveryCodeDigest(`  ${CODE_A}  `, PEPPER_ONE)).toBe(canonical);
  });

  it('produces a different digest for a different code', () => {
    expect(computeRecoveryCodeDigest(CODE_A, PEPPER_ONE)).not.toBe(
      computeRecoveryCodeDigest(CODE_B, PEPPER_ONE),
    );
  });

  it('binds the digest to the selector, not only to the secret half', () => {
    // A digest lifted out of one recovery set must not verify against another.
    expect(computeRecoveryCodeDigest(CODE_A, PEPPER_ONE)).not.toBe(
      computeRecoveryCodeDigest(CODE_C, PEPPER_ONE),
    );
  });

  it('produces a different digest for a different pepper', () => {
    expect(computeRecoveryCodeDigest(CODE_A, PEPPER_ONE)).not.toBe(
      computeRecoveryCodeDigest(CODE_A, PEPPER_TWO),
    );
  });
});

describe('recovery digest — shape', () => {
  it('emits base64 of a 32-byte HMAC-SHA-256', () => {
    const digest = computeRecoveryCodeDigest(CODE_A, PEPPER_ONE);

    expect(digest).toHaveLength(RECOVERY_DIGEST_BASE64_LENGTH);
    expect(Buffer.from(digest, 'base64')).toHaveLength(RECOVERY_DIGEST_BYTES);
    expect(isWellFormedRecoveryDigest(digest)).toBe(true);
  });

  it('pins the declared algorithm and version', () => {
    expect(RECOVERY_DIGEST_ALGORITHM).toBe('HMAC-SHA-256');
    expect(RECOVERY_DIGEST_VERSION).toBe(1);
  });

  it('rejects malformed digest shapes', () => {
    expect(isWellFormedRecoveryDigest('')).toBe(false);
    expect(isWellFormedRecoveryDigest('not-base64!!')).toBe(false);
    expect(isWellFormedRecoveryDigest(Buffer.alloc(16).toString('base64'))).toBe(false);
    expect(isWellFormedRecoveryDigest(null)).toBe(false);
    expect(isWellFormedRecoveryDigest(undefined)).toBe(false);
  });
});

describe('recovery digest — pepper handling', () => {
  it('refuses to hash without a usable pepper', () => {
    expect(() => computeRecoveryCodeDigest(CODE_A, Buffer.alloc(0))).toThrow(RecoveryError);
    expect(() =>
      computeRecoveryCodeDigest(CODE_A, Buffer.alloc(RECOVERY_PEPPER_MIN_BYTES - 1)),
    ).toThrow(RecoveryError);
  });

  it('reports PEPPER_UNAVAILABLE rather than a specific detail', () => {
    try {
      computeRecoveryCodeDigest(CODE_A, Buffer.alloc(4));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as RecoveryError).internalCode).toBe('PEPPER_UNAVAILABLE');
      // The message must not describe the key at all.
      expect((err as Error).message).toBe('PEPPER_UNAVAILABLE');
    }
  });

  it('validates the pepper before touching the code', () => {
    // Bad pepper AND bad code — the pepper failure must win, so a malformed
    // input can never be used to probe whether a pepper is configured.
    try {
      computeRecoveryCodeDigest('garbage', Buffer.alloc(4));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as RecoveryError).internalCode).toBe('PEPPER_UNAVAILABLE');
    }
  });

  it('requires at least 32 bytes of key material', () => {
    expect(RECOVERY_PEPPER_MIN_BYTES).toBe(32);
    expect(() =>
      computeRecoveryCodeDigest(CODE_A, randomBytes(RECOVERY_PEPPER_MIN_BYTES)),
    ).not.toThrow();
  });
});

describe('recovery digest — malformed code input', () => {
  it('never digests unvalidated input', () => {
    for (const invalid of ['', 'nope', `${RECOVERY_CODE_PREFIX}SHORT`, 'A'.repeat(300)]) {
      expect(() => computeRecoveryCodeDigest(invalid, PEPPER_ONE)).toThrow(RecoveryError);
    }
  });
});

describe('recovery digest — comparison', () => {
  it('matches identical digests', () => {
    const digest = computeRecoveryCodeDigest(CODE_A, PEPPER_ONE);
    expect(recoveryDigestsMatch(digest, digest)).toBe(true);
  });

  it('rejects different digests', () => {
    expect(
      recoveryDigestsMatch(
        computeRecoveryCodeDigest(CODE_A, PEPPER_ONE),
        computeRecoveryCodeDigest(CODE_B, PEPPER_ONE),
      ),
    ).toBe(false);
  });

  it('returns false rather than throwing on malformed or mismatched input', () => {
    const digest = computeRecoveryCodeDigest(CODE_A, PEPPER_ONE);

    expect(recoveryDigestsMatch(digest, '')).toBe(false);
    expect(recoveryDigestsMatch('', digest)).toBe(false);
    expect(recoveryDigestsMatch(digest, Buffer.alloc(16).toString('base64'))).toBe(false);
    expect(recoveryDigestsMatch(digest, 'not base64 at all')).toBe(false);
    expect(recoveryDigestsMatch(null as unknown as string, digest)).toBe(false);
  });

  it('compares in constant time via timingSafeEqual', () => {
    // Behavioural proxy: digests differing only in the LAST byte and digests
    // differing in the FIRST byte are both simply false, with no early exit
    // observable through the API surface.
    const base = Buffer.alloc(RECOVERY_DIGEST_BYTES, 0);
    const firstByteDiffers = Buffer.from(base);
    firstByteDiffers[0] = 1;
    const lastByteDiffers = Buffer.from(base);
    lastByteDiffers[RECOVERY_DIGEST_BYTES - 1] = 1;

    expect(
      recoveryDigestsMatch(base.toString('base64'), firstByteDiffers.toString('base64')),
    ).toBe(false);
    expect(
      recoveryDigestsMatch(base.toString('base64'), lastByteDiffers.toString('base64')),
    ).toBe(false);
  });
});
