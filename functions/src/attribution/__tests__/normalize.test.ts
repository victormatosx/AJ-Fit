import { describe, expect, it } from 'vitest';
import { normalizePromoCode } from '../normalize';

describe('normalizePromoCode', () => {
  it('accepts an already-normalized code unchanged', () => {
    expect(normalizePromoCode('ARNALDO')).toBe('ARNALDO');
  });

  it('uppercases a lowercase code', () => {
    expect(normalizePromoCode('arnaldo')).toBe('ARNALDO');
  });

  it('uppercases a mixed-case code', () => {
    expect(normalizePromoCode('ArNaLdO')).toBe('ARNALDO');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizePromoCode('  arnaldo  ')).toBe('ARNALDO');
  });

  it('trims whitespace mixed with case changes', () => {
    expect(normalizePromoCode('\t HeLlLeN\n')).toBe('HELLLEN');
  });

  it('allows digits, underscores, and hyphens', () => {
    expect(normalizePromoCode('promo_2026-vip')).toBe('PROMO_2026-VIP');
  });

  it('rejects an empty string', () => {
    expect(normalizePromoCode('')).toBeNull();
  });

  it('rejects a string that is only whitespace', () => {
    expect(normalizePromoCode('    ')).toBeNull();
  });

  it('rejects a code exceeding the max normalized length', () => {
    expect(normalizePromoCode('A'.repeat(33))).toBeNull();
  });

  it('accepts a code at exactly the max normalized length', () => {
    expect(normalizePromoCode('A'.repeat(32))).toBe('A'.repeat(32));
  });

  it('rejects raw input far exceeding the raw-input cap', () => {
    expect(normalizePromoCode('A'.repeat(1000))).toBeNull();
  });

  it('rejects internal spaces', () => {
    expect(normalizePromoCode('ARNA LDO')).toBeNull();
  });

  it('rejects a slash (invalid/ambiguous Firestore document-ID segment)', () => {
    expect(normalizePromoCode('ARNALDO/2026')).toBeNull();
  });

  it('rejects a zero-width space hidden inside an otherwise valid code', () => {
    expect(normalizePromoCode('ARNA​LDO')).toBeNull();
  });

  it('rejects other punctuation outside the allowlist', () => {
    expect(normalizePromoCode('ARNALDO!')).toBeNull();
    expect(normalizePromoCode('ARNALDO.VIP')).toBeNull();
    expect(normalizePromoCode('#ARNALDO')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(normalizePromoCode(undefined)).toBeNull();
    expect(normalizePromoCode(null)).toBeNull();
    expect(normalizePromoCode(123)).toBeNull();
    expect(normalizePromoCode({ code: 'ARNALDO' })).toBeNull();
  });
});
