import { describe, expect, it } from 'vitest';
import { resolvePromoCodePlatform } from '../promoCodePlatform';

describe('resolvePromoCodePlatform — FASE iOS-2', () => {
  it('A: "android" resolves to the wire literal "ANDROID"', () => {
    expect(resolvePromoCodePlatform('android')).toBe('ANDROID');
  });

  it('B: "ios" resolves to the wire literal "IOS"', () => {
    expect(resolvePromoCodePlatform('ios')).toBe('IOS');
  });

  it('C: an unsupported platform ("web") throws instead of silently defaulting to ANDROID or IOS', () => {
    expect(() => resolvePromoCodePlatform('web')).toThrow();
  });

  it('C: any other unrecognized value throws (fail-closed, not a guess)', () => {
    expect(() => resolvePromoCodePlatform('windows')).toThrow();
    expect(() => resolvePromoCodePlatform('')).toThrow();
    expect(() => resolvePromoCodePlatform('Android')).toThrow(); // case-sensitive — never coerced
    expect(() => resolvePromoCodePlatform('IOS')).toThrow(); // already-wire-format input is not accepted as OS input
  });
});
