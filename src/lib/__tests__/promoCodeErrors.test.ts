import { describe, expect, it } from 'vitest';
import { classifyPromoCodeError, normalizePromoCodeInput } from '../promoCodeErrors';

function fakeError(code: string, message?: string) {
  return { code, message };
}

describe('classifyPromoCodeError', () => {
  it('maps functions/unauthenticated', () => {
    const result = classifyPromoCodeError(fakeError('functions/unauthenticated'));
    expect(result.reason).toBe('unauthenticated');
  });

  it('maps functions/invalid-argument to invalid_code', () => {
    const result = classifyPromoCodeError(fakeError('functions/invalid-argument', 'invalid_code_format'));
    expect(result.reason).toBe('invalid_code');
  });

  it('maps functions/not-found to a single generic "unavailable" message (K: anti-enumeration preserved)', () => {
    const nonexistent = classifyPromoCodeError(
      fakeError('functions/not-found', 'promo_code_unavailable'),
    );
    const inactiveOrExpired = classifyPromoCodeError(
      fakeError('functions/not-found', 'promo_code_unavailable'),
    );
    expect(nonexistent).toEqual(inactiveOrExpired);
    expect(nonexistent.reason).toBe('unavailable');
  });

  it('E: maps functions/failed-precondition + attribution_locked to locked, with a distinct message', () => {
    const result = classifyPromoCodeError(
      fakeError('functions/failed-precondition', 'attribution_locked'),
    );
    expect(result.reason).toBe('locked');
    expect(result.message).toContain('não pode mais ser alterado');
  });

  it('maps functions/failed-precondition + user_not_found to temporary, not locked', () => {
    const result = classifyPromoCodeError(
      fakeError('functions/failed-precondition', 'user_not_found'),
    );
    expect(result.reason).toBe('temporary');
  });

  it('D: maps an unrecognized/internal error to temporary, never showing a raw code/stack', () => {
    const result = classifyPromoCodeError(fakeError('functions/internal', 'some internal detail'));
    expect(result.reason).toBe('temporary');
    expect(result.message).not.toMatch(/internal|functions\//);
  });

  it('maps a plain network Error (no .code) to temporary', () => {
    const result = classifyPromoCodeError(new Error('Network request failed'));
    expect(result.reason).toBe('temporary');
  });

  it('maps an unrecognized functions/* code (e.g. functions/unavailable) to temporary', () => {
    const result = classifyPromoCodeError(fakeError('functions/unavailable', 'backend unreachable'));
    expect(result.reason).toBe('temporary');
  });

  it('maps a thrown non-Error value (string) to temporary, without throwing', () => {
    const result = classifyPromoCodeError('boom');
    expect(result.reason).toBe('temporary');
  });

  it('maps a thrown plain object with no code/message to temporary, without throwing', () => {
    const result = classifyPromoCodeError({ unexpected: 'shape' });
    expect(result.reason).toBe('temporary');
  });

  it('never leaks the raw backend message string into the L (never promises trial) surface', () => {
    const result = classifyPromoCodeError(fakeError('functions/not-found', 'promo_code_unavailable'));
    expect(result.message).not.toMatch(/trial|garantid/i);
  });
});

describe('normalizePromoCodeInput', () => {
  it('trims and uppercases for display convenience', () => {
    expect(normalizePromoCodeInput('  arnaldo  ')).toBe('ARNALDO');
  });

  it('is purely cosmetic — does not reject or reformat invalid characters (backend is the authority)', () => {
    expect(normalizePromoCodeInput('  arn aldo!! ')).toBe('ARN ALDO!!');
  });
});
