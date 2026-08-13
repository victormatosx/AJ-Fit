import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock('expo-localization', () => ({
  getLocales: vi.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { LANGUAGE_STORAGE_KEY } from '../languageStorage';

const mockGetItem = vi.mocked(AsyncStorage.getItem);
const mockGetLocales = vi.mocked(Localization.getLocales);

/**
 * i18next holds process-global state (single default instance + plugin
 * registrations from `initReactI18next`). Each test needs a fresh module
 * graph, so we clear the memoized init promise via the exported test-only
 * escape hatch AND reset i18n's own store back to a clean slate before every
 * scenario. `resetModules()` isn't enough on its own because the singleton
 * would linger across tests through the react-i18next plugin.
 */
async function freshI18n() {
  vi.resetModules();
  const { default: i18n, __resetI18nForTests, initI18n } = await import(
    '../index'
  );
  __resetI18nForTests();
  if (i18n.isInitialized) {
    // Wipe language/resources so the next init call re-applies them cleanly.
    // We don't call i18n.off/unuse — the plugin re-registers safely.
    await i18n.changeLanguage(undefined as unknown as string).catch(() => {});
  }
  return { i18n, initI18n };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('initI18n — language resolution', () => {
  it('uses the stored language when present, ignoring the system locale', async () => {
    mockGetItem.mockResolvedValueOnce('es');
    mockGetLocales.mockReturnValue([{ languageTag: 'pt-BR' } as never]);
    const { i18n, initI18n } = await freshI18n();

    const resolved = await initI18n();

    expect(resolved).toBe('es');
    expect(i18n.language).toBe('es');
    expect(mockGetItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY);
  });

  it('falls back to the system locale when nothing is stored', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    mockGetLocales.mockReturnValue([{ languageTag: 'pt-BR' } as never]);
    const { i18n, initI18n } = await freshI18n();

    const resolved = await initI18n();

    expect(resolved).toBe('pt-BR');
    expect(i18n.language).toBe('pt-BR');
  });

  it('falls back to English when the system locale is unsupported', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    mockGetLocales.mockReturnValue([{ languageTag: 'fr-FR' } as never]);
    const { i18n, initI18n } = await freshI18n();

    const resolved = await initI18n();

    expect(resolved).toBe('en');
    expect(i18n.language).toBe('en');
  });

  it('falls back to English when the system exposes no locale at all', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    // `getLocales` types the return as a non-empty tuple; the empty case is
    // realistic in edge scenarios (uninitialized simulator locale), so we
    // force it through the mock to exercise the `?? null` branch in
    // resolveInitialLanguage.
    mockGetLocales.mockReturnValue([] as unknown as ReturnType<typeof Localization.getLocales>);
    const { i18n, initI18n } = await freshI18n();

    const resolved = await initI18n();

    expect(resolved).toBe('en');
    expect(i18n.language).toBe('en');
  });
});

describe('initI18n — initialization safety', () => {
  it('is idempotent: parallel and repeated calls resolve to the same value without re-initializing', async () => {
    mockGetItem.mockResolvedValue('pt-BR');
    mockGetLocales.mockReturnValue([{ languageTag: 'en-US' } as never]);
    const { initI18n } = await freshI18n();

    const [a, b, c] = await Promise.all([initI18n(), initI18n(), initI18n()]);
    const d = await initI18n();

    expect(a).toBe('pt-BR');
    expect(b).toBe('pt-BR');
    expect(c).toBe('pt-BR');
    expect(d).toBe('pt-BR');
    // Storage read happens exactly once even under parallel invocations —
    // module-level `initPromise` memoizes the entire pipeline.
    expect(mockGetItem).toHaveBeenCalledTimes(1);
  });

  it('configures en as the ultimate fallback in i18next itself', async () => {
    mockGetItem.mockResolvedValue('pt-BR');
    mockGetLocales.mockReturnValue([{ languageTag: 'en-US' } as never]);
    const { i18n, initI18n } = await freshI18n();

    await initI18n();

    // options.fallbackLng may be a string, string[], or object depending on
    // i18next's runtime normalization — accept any of those shapes.
    const fallback = i18n.options.fallbackLng;
    const flat = Array.isArray(fallback)
      ? fallback
      : typeof fallback === 'string'
        ? [fallback]
        : Object.values(fallback ?? {}).flat();
    expect(flat).toContain('en');
  });

  it('loads all three language resources (pt-BR, en, es) with the common namespace', async () => {
    mockGetItem.mockResolvedValue('pt-BR');
    mockGetLocales.mockReturnValue([{ languageTag: 'en-US' } as never]);
    const { i18n, initI18n } = await freshI18n();

    await initI18n();

    expect(i18n.hasResourceBundle('pt-BR', 'common')).toBe(true);
    expect(i18n.hasResourceBundle('en', 'common')).toBe(true);
    expect(i18n.hasResourceBundle('es', 'common')).toBe(true);
  });

  it('resolves the smoke-test key in each language', async () => {
    mockGetItem.mockResolvedValue('pt-BR');
    mockGetLocales.mockReturnValue([{ languageTag: 'en-US' } as never]);
    const { i18n, initI18n } = await freshI18n();

    await initI18n();

    expect(i18n.getFixedT('pt-BR', 'common')('actions.continue')).toBe(
      'Continuar',
    );
    expect(i18n.getFixedT('en', 'common')('actions.continue')).toBe('Continue');
    expect(i18n.getFixedT('es', 'common')('actions.continue')).toBe(
      'Continuar',
    );
  });
});
