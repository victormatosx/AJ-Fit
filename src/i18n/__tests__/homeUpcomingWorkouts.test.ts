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

type LooseT = (key: string, options?: Record<string, unknown>) => string;

const LANGUAGES = ['pt-BR', 'en', 'es'] as const;

async function freshI18nAt(lang: SupportedLanguage) {
  vi.resetModules();
  mockGetItem.mockResolvedValueOnce(lang);
  const { default: i18n, __resetI18nForTests, initI18n } = await import('../index');
  __resetI18nForTests();
  await initI18n();
  return i18n;
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.resetAllMocks(); });

describe('home — "próximos treinos" copy', () => {
  it.each([
    ['pt-BR', /próximos treinos/i],
    ['en', /upcoming workouts/i],
    ['es', /próximos entrenamientos/i],
  ] as [SupportedLanguage, RegExp][])('[%s] section title', async (lang, re) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'home' as 'home') as unknown as LooseT;
    expect(t('upcoming.title')).toMatch(re);
  });

  it('interpolates the estimate + exercise count, and marks the duration as approximate', async () => {
    for (const lang of LANGUAGES) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'home' as 'home') as unknown as LooseT;
      const out = t('upcoming.meta', { minutes: 54, count: 7 });
      expect(out).toContain('54');
      expect(out).toContain('7');
      // The minutes are a derived estimate, never a measured fact.
      expect(out).toContain('~');
      expect(out).not.toContain('{{');
    }
  });

  it('pluralizes the exercise count in every locale', async () => {
    for (const lang of LANGUAGES) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'home' as 'home') as unknown as LooseT;
      const one = t('upcoming.meta', { minutes: 30, count: 1 });
      const many = t('upcoming.meta', { minutes: 30, count: 7 });
      expect(one).not.toBe(many);
      expect(one).not.toContain('upcoming.meta');
      expect(many).not.toContain('upcoming.meta');
    }
  });

  it('offers a count-only variant for a session with no estimable duration', async () => {
    for (const lang of LANGUAGES) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'home' as 'home') as unknown as LooseT;
      const out = t('upcoming.metaNoEstimate', { count: 7 });
      expect(out).toContain('7');
      expect(out).not.toContain('~');
      expect(out).not.toContain('{{');
    }
  });

  it('resolves every detail-sheet key with its interpolations', async () => {
    for (const lang of LANGUAGES) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'home' as 'home') as unknown as LooseT;
      const cases: [string, Record<string, unknown>][] = [
        ['upcoming.open', { weekday: 'QUA', session: 'Push' }],
        ['upcoming.detail.kicker', {}],
        ['upcoming.detail.close', {}],
        ['upcoming.detail.scheduledFor', { weekday: 'Qua', date: '17 set' }],
        ['upcoming.detail.exercises', {}],
        ['upcoming.detail.setsReps', { sets: 3, reps: '8-12' }],
        ['upcoming.detail.setsDuration', { sets: 3, duration: '30s' }],
        ['upcoming.detail.rest', { seconds: 90 }],
        ['upcoming.detail.estimateNote', {}],
        ['upcoming.detail.unavailable', {}],
      ];
      for (const [key, options] of cases) {
        const out = t(key, options);
        expect(out).not.toBe(key);
        expect(out).not.toContain('{{');
        expect(out.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
