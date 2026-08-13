import { describe, expect, it } from 'vitest';
import { resolveUnits } from '../resolveUnits';

describe('resolveUnits', () => {
  it.each([
    ['en-US', 'imperial'],
    ['es-US', 'imperial'],
    ['pt-BR', 'metric'],
    ['es-ES', 'metric'],
    ['en-GB', 'metric'],
  ] as const)('resolves system locale %s to %s', (languageTag, expected) => {
    expect(
      resolveUnits({ preference: 'system', regionCode: null, languageTag }),
    ).toBe(expected);
  });

  it('uses imperial units when the region is US', () => {
    expect(
      resolveUnits({
        preference: 'system',
        regionCode: 'US',
        languageTag: 'pt-BR',
      }),
    ).toBe('imperial');
  });

  it('defaults to metric when locale information is absent', () => {
    expect(
      resolveUnits({
        preference: 'system',
        regionCode: null,
        languageTag: null,
      }),
    ).toBe('metric');
  });

  it('honors a manual metric preference regardless of locale', () => {
    expect(
      resolveUnits({
        preference: 'metric',
        regionCode: 'US',
        languageTag: 'en-US',
      }),
    ).toBe('metric');
  });

  it('honors a manual imperial preference regardless of locale', () => {
    expect(
      resolveUnits({
        preference: 'imperial',
        regionCode: 'BR',
        languageTag: 'pt-BR',
      }),
    ).toBe('imperial');
  });
});
