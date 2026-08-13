import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({
  getLocales: vi.fn(),
}));

import { getLocales } from 'expo-localization';
import { resolveCurrentUnits } from '../resolveCurrentUnits';

const mockGetLocales = vi.mocked(getLocales);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveCurrentUnits', () => {
  it('reads the current device locale each time system units are resolved', () => {
    mockGetLocales.mockReturnValueOnce([
      { regionCode: 'BR', languageTag: 'pt-BR' } as never,
    ]);
    expect(resolveCurrentUnits('system')).toBe('metric');

    mockGetLocales.mockReturnValueOnce([
      { regionCode: 'US', languageTag: 'en-US' } as never,
    ]);
    expect(resolveCurrentUnits('system')).toBe('imperial');
    expect(mockGetLocales).toHaveBeenCalledTimes(2);
  });

  it('keeps a manual preference independent from device locale', () => {
    mockGetLocales.mockReturnValue([
      { regionCode: 'US', languageTag: 'en-US' } as never,
    ]);
    expect(resolveCurrentUnits('metric')).toBe('metric');
  });
});
