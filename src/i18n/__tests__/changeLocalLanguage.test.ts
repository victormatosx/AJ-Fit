import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock('expo-localization', () => ({
  getLocales: vi.fn().mockReturnValue([{ languageTag: 'pt-BR' } as never]),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { LANGUAGE_STORAGE_KEY } from '../languageStorage';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../types/language';

const mockGetItem = vi.mocked(AsyncStorage.getItem);
const mockSetItem = vi.mocked(AsyncStorage.setItem);

/**
 * Same discipline as i18n.test.ts: i18next holds a singleton, so each test
 * re-imports the module graph with `vi.resetModules()` and calls the
 * test-only reset hook. This guarantees `changeLocalLanguage` runs against
 * a freshly initialized i18n every time.
 */
async function freshI18nWith(startingLang: SupportedLanguage) {
  vi.resetModules();
  const { default: i18n, __resetI18nForTests, initI18n } = await import('../index');
  __resetI18nForTests();
  mockGetItem.mockResolvedValueOnce(startingLang);
  await initI18n();
  const { changeLocalLanguage } = await import('../changeLocalLanguage');
  // Clear the getItem/setItem calls made during init so tests only see the
  // interactions triggered by changeLocalLanguage itself.
  mockGetItem.mockClear();
  mockSetItem.mockClear();
  return { i18n, changeLocalLanguage };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('changeLocalLanguage — happy path transitions', () => {
  const TRANSITIONS: Array<[SupportedLanguage, SupportedLanguage]> = [
    ['pt-BR', 'en'],
    ['en', 'es'],
    ['es', 'pt-BR'],
    ['pt-BR', 'es'],
    ['en', 'pt-BR'],
    ['es', 'en'],
  ];

  it.each(TRANSITIONS)('switches %s → %s and persists to AsyncStorage', async (from, to) => {
    mockSetItem.mockResolvedValueOnce(undefined);
    const { i18n, changeLocalLanguage } = await freshI18nWith(from);

    await changeLocalLanguage(to);

    expect(i18n.language).toBe(to);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, to);
  });
});

describe('changeLocalLanguage — idempotence', () => {
  it.each(SUPPORTED_LANGUAGES)(
    'is a no-op when the requested language equals the current: %s',
    async (lang) => {
      const { i18n, changeLocalLanguage } = await freshI18nWith(lang);

      await changeLocalLanguage(lang);

      expect(i18n.language).toBe(lang);
      expect(mockSetItem).not.toHaveBeenCalled();
    },
  );
});

describe('changeLocalLanguage — validation', () => {
  it('rejects values outside the language contract before touching i18n or storage', async () => {
    const { i18n, changeLocalLanguage } = await freshI18nWith('pt-BR');

    await expect(
      changeLocalLanguage('fr' as unknown as SupportedLanguage),
    ).rejects.toThrow(/not a supported language/);

    expect(i18n.language).toBe('pt-BR');
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});

describe('changeLocalLanguage — error handling', () => {
  it('rolls back i18n when AsyncStorage write fails, leaving disk and runtime in sync', async () => {
    // AsyncStorage refuses to persist — critical failure mode: without
    // rollback the UI would show `en` while the next cold start would
    // still read `pt-BR` from disk, creating a flicker on every launch.
    mockSetItem.mockRejectedValueOnce(new Error('quota exceeded'));
    const { i18n, changeLocalLanguage } = await freshI18nWith('pt-BR');

    await expect(changeLocalLanguage('en')).rejects.toThrow(/quota exceeded/);

    expect(i18n.language).toBe('pt-BR');
    expect(mockSetItem).toHaveBeenCalledTimes(1);
  });

  it('does not persist when i18next itself refuses the change', async () => {
    const { i18n, changeLocalLanguage } = await freshI18nWith('pt-BR');
    // Force i18n.changeLanguage to reject — persistence must never happen
    // in that path because there's nothing to persist yet.
    const changeSpy = vi
      .spyOn(i18n, 'changeLanguage')
      .mockRejectedValueOnce(new Error('changeLanguage boom'));

    await expect(changeLocalLanguage('en')).rejects.toThrow(/changeLanguage boom/);

    expect(mockSetItem).not.toHaveBeenCalled();
    changeSpy.mockRestore();
  });
});

describe('changeLocalLanguage — persistence surface', () => {
  it('the persisted value survives an i18n re-init (Fast Refresh / cold start)', async () => {
    // First session: switch to 'es' and persist.
    mockSetItem.mockResolvedValueOnce(undefined);
    let session = await freshI18nWith('pt-BR');
    await session.changeLocalLanguage('es');
    expect(session.i18n.language).toBe('es');
    expect(mockSetItem).toHaveBeenLastCalledWith(LANGUAGE_STORAGE_KEY, 'es');

    // Simulate a cold start: AsyncStorage now returns whatever we last
    // wrote. A fresh init must land on that value, without asking the OS
    // locale again.
    mockGetItem.mockResolvedValueOnce('es');
    session = await freshI18nWith('es');
    expect(session.i18n.language).toBe('es');
  });
});

describe('settings resources — smoke test wiring', () => {
  it('each language exposes native language names for the picker', async () => {
    const { i18n } = await freshI18nWith('pt-BR');

    // The picker calls `t('settings:language.options', { returnObjects: true })`
    // — every locale must ship the same shape so the picker never renders a
    // placeholder for an option that happens to be missing in that locale.
    for (const lang of SUPPORTED_LANGUAGES) {
      const opts = i18n.getFixedT(lang, 'settings')('language.options', {
        returnObjects: true,
      }) as Record<SupportedLanguage, string>;
      expect(opts['pt-BR']).toBe('Português');
      expect(opts['en']).toBe('English');
      expect(opts['es']).toBe('Español');
    }
  });

  it('each language provides its own picker title and error message', async () => {
    const { i18n } = await freshI18nWith('pt-BR');

    const cases: Array<[SupportedLanguage, RegExp, RegExp]> = [
      ['pt-BR', /selecionar/i, /não foi possível/i],
      ['en', /select/i, /couldn't save/i],
      ['es', /seleccionar/i, /no se pudo/i],
    ];
    for (const [lang, titleRe, errorRe] of cases) {
      const t = i18n.getFixedT(lang, 'settings');
      expect(t('language.chooseTitle')).toMatch(titleRe);
      expect(t('language.errors.changeFailed')).toMatch(errorRe);
    }
  });
});
