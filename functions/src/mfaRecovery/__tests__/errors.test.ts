import { describe, expect, it } from 'vitest';

import {
  RECOVERY_PUBLIC_ERROR_CODE,
  RecoveryError,
  type RecoveryInternalCode,
  isRecoveryError,
  toPublicRecoveryError,
} from '../errors';

const ALL_INTERNAL_CODES: readonly RecoveryInternalCode[] = [
  'MALFORMED_CODE',
  'RECOVERY_SET_NOT_FOUND',
  'RECOVERY_SET_NOT_ACTIVE',
  'CODE_NOT_FOUND',
  'CODE_ALREADY_CONSUMED',
  'CODE_ALREADY_RESERVED',
  'OPERATION_CONFLICT',
  'INVALID_STATE_TRANSITION',
  'INVALID_RECOVERY_SET',
  'PEPPER_UNAVAILABLE',
  'RATE_LIMITED',
];

describe('recovery errors — public surface', () => {
  it('exposes exactly one public code', () => {
    expect(RECOVERY_PUBLIC_ERROR_CODE).toBe('mfa-recovery/recovery-unavailable');
  });

  it.each(ALL_INTERNAL_CODES)('collapses %s onto the single public code', (internalCode) => {
    const error = new RecoveryError(internalCode);

    expect(error.publicCode).toBe(RECOVERY_PUBLIC_ERROR_CODE);
    expect(toPublicRecoveryError(error)).toBe(RECOVERY_PUBLIC_ERROR_CODE);
  });

  it('cannot distinguish an unknown account from a wrong code', () => {
    // The whole anti-enumeration property in one assertion: these three very
    // different failures are indistinguishable from outside.
    const notFound = toPublicRecoveryError(new RecoveryError('RECOVERY_SET_NOT_FOUND'));
    const wrongCode = toPublicRecoveryError(new RecoveryError('CODE_NOT_FOUND'));
    const malformed = toPublicRecoveryError(new RecoveryError('MALFORMED_CODE'));

    expect(notFound).toBe(wrongCode);
    expect(wrongCode).toBe(malformed);
  });

  it('collapses unexpected non-recovery failures too', () => {
    expect(toPublicRecoveryError(new Error('Firestore unavailable: project ajfit-2f321'))).toBe(
      RECOVERY_PUBLIC_ERROR_CODE,
    );
    expect(toPublicRecoveryError(null)).toBe(RECOVERY_PUBLIC_ERROR_CODE);
    expect(toPublicRecoveryError(undefined)).toBe(RECOVERY_PUBLIC_ERROR_CODE);
  });
});

describe('recovery errors — internal surface', () => {
  it('carries the internal code and nothing else in the message', () => {
    for (const internalCode of ALL_INTERNAL_CODES) {
      const error = new RecoveryError(internalCode);

      expect(error.internalCode).toBe(internalCode);
      // No detail slot exists, so a call site cannot append a code or a uid.
      expect(error.message).toBe(internalCode);
      expect(error.name).toBe('RecoveryError');
    }
  });

  it('uses only fixed constants with no interpolation slots', () => {
    for (const internalCode of ALL_INTERNAL_CODES) {
      expect(internalCode).toMatch(/^[A-Z_]+$/);
    }
  });

  it('is identifiable via a type guard', () => {
    expect(isRecoveryError(new RecoveryError('RATE_LIMITED'))).toBe(true);
    expect(isRecoveryError(new Error('nope'))).toBe(false);
    expect(isRecoveryError(null)).toBe(false);
  });

  it('is a real Error, so it survives throw/catch and instanceof', () => {
    try {
      throw new RecoveryError('CODE_ALREADY_CONSUMED');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(RecoveryError);
    }
  });
});
