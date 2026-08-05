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
import type { SupportedLanguage } from '../../types/language';

const mockGetItem = vi.mocked(AsyncStorage.getItem);

/**
 * Cast escape hatch for tests that need to query keys dynamically. The
 * production `CustomTypeOptions` augmentation makes `t()` reject anything
 * not in the tree — great for app code, cumbersome for parameterized tests
 * that iterate keys as strings. `LooseT` narrows to a plain function type
 * (no `any`) so the strict tree is honored everywhere else.
 */
type LooseT = (key: string, opts?: Record<string, unknown>) => string;

async function freshI18nAt(lang: SupportedLanguage) {
  vi.resetModules();
  mockGetItem.mockResolvedValueOnce(lang);
  const { default: i18n, __resetI18nForTests, initI18n } = await import('../index');
  __resetI18nForTests();
  await initI18n();
  return i18n;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('i18next — namespaces registered', () => {
  it('loads common + settings + errors for every supported language', async () => {
    const i18n = await freshI18nAt('pt-BR');
    for (const lang of ['pt-BR', 'en', 'es'] as const) {
      expect(i18n.hasResourceBundle(lang, 'common')).toBe(true);
      expect(i18n.hasResourceBundle(lang, 'settings')).toBe(true);
      expect(i18n.hasResourceBundle(lang, 'errors')).toBe(true);
    }
  });
});

describe('i18next — shared actions render per locale', () => {
  const CASES: Array<[SupportedLanguage, string, string, string]> = [
    ['pt-BR', 'common', 'actions.continue', 'Continuar'],
    ['en', 'common', 'actions.continue', 'Continue'],
    ['es', 'common', 'actions.continue', 'Continuar'],
    ['pt-BR', 'common', 'actions.cancel', 'Cancelar'],
    ['en', 'common', 'actions.cancel', 'Cancel'],
    ['es', 'common', 'actions.cancel', 'Cancelar'],
    ['pt-BR', 'common', 'actions.save', 'Salvar'],
    ['en', 'common', 'actions.save', 'Save'],
    ['es', 'common', 'actions.save', 'Guardar'],
    ['pt-BR', 'common', 'actions.retry', 'Tentar novamente'],
    ['en', 'common', 'actions.retry', 'Try again'],
    ['es', 'common', 'actions.retry', 'Reintentar'],
    ['pt-BR', 'common', 'accessibility.day', 'Dia'],
    ['en', 'common', 'accessibility.day', 'Day'],
    ['es', 'common', 'accessibility.day', 'Día'],
  ];

  it.each(CASES)('[%s] %s:%s = %s', async (lang, ns, path, expected) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, ns as 'common') as unknown as LooseT;
    expect(t(path)).toBe(expected);
  });
});

describe('i18next — generic errors render per locale', () => {
  it('exposes network + operation + generic messages per locale', async () => {
    const i18n = await freshI18nAt('pt-BR');
    const cases: Array<[SupportedLanguage, string, RegExp]> = [
      ['pt-BR', 'network.unavailable', /sem conexão/i],
      ['en', 'network.unavailable', /no connection/i],
      ['es', 'network.unavailable', /sin conexión/i],
      ['pt-BR', 'operation.failed', /não foi possível/i],
      ['en', 'operation.failed', /couldn't be completed/i],
      ['es', 'operation.failed', /no se pudo/i],
    ];
    for (const [lang, path, re] of cases) {
      const t = i18n.getFixedT(lang, 'errors') as unknown as LooseT;
      expect(t(path), `errors:${path} in ${lang}`).toMatch(re);
    }
  });
});

describe('i18next — fallback to English when a locale is missing a key', () => {
  it('falls through to en when a hypothetical es key is absent', async () => {
    const i18n = await freshI18nAt('es');
    // Inject a namespace only into en so lookup in es must fall back.
    // We do NOT touch a real resource file — the whole point of this test
    // is to prove the fallback pipeline WITHOUT depending on any locale
    // being incomplete on disk (which parity tests forbid anyway).
    i18n.addResource('en', 'common', 'phase4Fallback.hello', 'Hello from EN');
    const t = i18n.t as unknown as LooseT;
    expect(t('common:phase4Fallback.hello', { lng: 'es' })).toBe(
      'Hello from EN',
    );
  });

  it('leaves the resolved key untouched when no locale has it (default i18next behavior — returns the key string)', async () => {
    const i18n = await freshI18nAt('en');
    const t = i18n.t as unknown as LooseT;
    // Neither pt-BR, en nor es carries this key; i18next's default fallback
    // of last resort is to return the KEY portion (without the namespace
    // prefix). The UI should never render this — components must always
    // use keys they defined — and the parity test above prevents shipping
    // one that this fallback would ever trigger for.
    expect(t('common:phase4Fallback.nowhere')).toBe('phase4Fallback.nowhere');
  });
});

describe('i18next — no bare i18n keys leak into DateFieldsInput/DateWheelPicker labels', () => {
  it('accessibility.day/month/year resolve to non-key strings in every locale', async () => {
    const i18n = await freshI18nAt('pt-BR');
    for (const lang of ['pt-BR', 'en', 'es'] as const) {
      const t = i18n.getFixedT(lang, 'common') as unknown as LooseT;
      for (const path of ['accessibility.day', 'accessibility.month', 'accessibility.year']) {
        const value = t(path);
        expect(value).not.toContain(':');
        expect(value).not.toContain('.');
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});
