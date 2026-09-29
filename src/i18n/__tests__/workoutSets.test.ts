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

async function freshI18nAt(lang: SupportedLanguage) {
  vi.resetModules();
  mockGetItem.mockResolvedValueOnce(lang);
  const { default: i18n, __resetI18nForTests, initI18n } = await import('../index');
  __resetI18nForTests();
  await initI18n();
  return i18n;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.resetAllMocks());

/**
 * Phase 7B — runtime coverage for sets, reps, load, rest, record, and the
 * final metrics summary. Every value that used to be a hardcoded PT literal
 * (or a `${...}` template) now flows through i18next with pluralization
 * driven by `count`. Two branches per plural rule are exercised (1 vs many).
 */

describe('workout — sets progress with plural on total', () => {
  it.each([
    ['pt-BR', 1, '0/1 série'],
    ['pt-BR', 25, '4/25 séries'],
    ['en', 1, '0/1 set'],
    ['en', 25, '4/25 sets'],
    ['es', 1, '0/1 serie'],
    ['es', 25, '4/25 series'],
  ] as Array<[SupportedLanguage, number, string]>)(
    '[%s] sets.progress total=%i',
    async (lang, total, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      const done = total === 1 ? 0 : 4;
      expect(t('sets.progress', { done, total, count: total })).toBe(expected);
    },
  );
});

describe('workout — sets.number label per locale', () => {
  it.each([
    ['pt-BR', 3, 'Série 3'],
    ['en', 3, 'Set 3'],
    ['es', 3, 'Serie 3'],
  ] as Array<[SupportedLanguage, number, string]>)(
    '[%s] sets.number(%i)',
    async (lang, number, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t('sets.number', { number })).toBe(expected);
    },
  );
});

describe('workout — summary (weighted vs bodyweight) with reps plural', () => {
  // `reps` is always the raw display string `WorkoutScreen` actually passes
  // (via `pluralCountForReps` for `count`, `s0.r` verbatim for `{{reps}}`) —
  // a plain number, but also possibly a range ("8-12") or duration ("30s").
  // `count` and the displayed `reps` are deliberately independent so a range
  // still renders its exact text while correctly picking the plural form.
  it.each([
    ['pt-BR', 1, '1', 60, '1 rep × 60 kg'],
    ['pt-BR', 2, '10', 60, '10 reps × 60 kg'],
    ['pt-BR', 2, '8-12', 60, '8-12 reps × 60 kg'],
    ['en', 1, '1', 60, '1 rep × 60 kg'],
    ['en', 2, '10', 60, '10 reps × 60 kg'],
    ['en', 2, '8-12', 60, '8-12 reps × 60 kg'],
    ['es', 1, '1', 60, '1 rep × 60 kg'],
    ['es', 2, '10', 60, '10 reps × 60 kg'],
    ['es', 2, '8-12', 60, '8-12 reps × 60 kg'],
  ] as Array<[SupportedLanguage, number, string, number, string]>)(
    '[%s] weighted %s × %i',
    async (lang, count, reps, weight, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t('sets.summaryWeighted', { count, reps, weight, unit: 'kg' })).toBe(expected);
    },
  );

  it.each([
    ['pt-BR', 1, '1', '1 rep × peso corporal'],
    ['pt-BR', 2, '8', '8 reps × peso corporal'],
    ['pt-BR', 2, '30s', '30s reps × peso corporal'],
    ['en', 1, '1', '1 rep × bodyweight'],
    ['en', 2, '8', '8 reps × bodyweight'],
    ['en', 2, '30s', '30s reps × bodyweight'],
    ['es', 1, '1', '1 rep × peso corporal'],
    ['es', 2, '8', '8 reps × peso corporal'],
    ['es', 2, '30s', '30s reps × peso corporal'],
  ] as Array<[SupportedLanguage, number, string, string]>)(
    '[%s] bodyweight %s',
    async (lang, count, reps, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t('sets.summaryBodyweight', { count, reps })).toBe(expected);
    },
  );

  it.each([
    ['pt-BR', 1, '1', '1 rep'],
    ['pt-BR', 2, '8', '8 reps'],
    ['pt-BR', 2, '30s', '30s reps'],
    ['en', 1, '1', '1 rep'],
    ['en', 2, '8', '8 reps'],
    ['en', 2, '30s', '30s reps'],
    ['es', 1, '1', '1 rep'],
    ['es', 2, '8', '8 reps'],
    ['es', 2, '30s', '30s reps'],
  ] as Array<[SupportedLanguage, number, string, string]>)(
    // No weight registered yet — WorkoutScreen shows reps only, never
    // "bodyweight"/"peso corporal" as a stand-in for "not logged yet".
    '[%s] no weight registered yet %s',
    async (lang, count, reps, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t('sets.summaryReps', { count, reps })).toBe(expected);
    },
  );

  it('never returns the raw key when reps is a non-numeric range/duration (the exact bug this hook regresses)', async () => {
    const i18n = await freshI18nAt('pt-BR');
    const t = i18n.getFixedT('pt-BR', 'workout' as 'workout') as unknown as LooseT;
    for (const reps of ['8-12', '30s', '—']) {
      const weighted = t('sets.summaryWeighted', {
        count: /^1$/.test(reps) ? 1 : 2,
        reps,
        weight: 60,
        unit: 'kg',
      });
      const bodyweight = t('sets.summaryBodyweight', {
        count: /^1$/.test(reps) ? 1 : 2,
        reps,
      });
      expect(weighted).not.toContain('summaryWeighted');
      expect(weighted).not.toContain('{{');
      expect(bodyweight).not.toContain('summaryBodyweight');
      expect(bodyweight).not.toContain('{{');
    }
  });
});

describe('workout — CTA "complete set N" per locale', () => {
  it.each([
    ['pt-BR', 3, 'Concluir série 3'],
    ['en', 3, 'Complete set 3'],
    ['es', 3, 'Completar serie 3'],
  ] as Array<[SupportedLanguage, number, string]>)(
    '[%s] actions.completeSet(%i)',
    async (lang, number, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t('actions.completeSet', { number })).toBe(expected);
    },
  );
});

describe('workout — rest overlay copy per locale', () => {
  it.each([
    ['pt-BR', 'rest.title', /descanso/i],
    ['en', 'rest.title', /rest/i],
    ['es', 'rest.title', /descanso/i],
    ['pt-BR', 'rest.minimize', /minimizar/i],
    ['en', 'rest.minimize', /minimize/i],
    ['es', 'rest.minimize', /minimizar/i],
    ['pt-BR', 'rest.optional', /^opcional$/i],
    ['en', 'rest.optional', /^optional$/i],
    ['es', 'rest.optional', /^opcional$/i],
    ['pt-BR', 'rest.inputHint', /toque no valor/i],
    ['en', 'rest.inputHint', /tap the value/i],
    ['es', 'rest.inputHint', /toca el valor/i],
    ['pt-BR', 'rest.nextSet', /próxima série/i],
    ['en', 'rest.nextSet', /next set/i],
    ['es', 'rest.nextSet', /próxima serie/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)('[%s] workout:%s', async (lang, key, re) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
    expect(t(key)).toMatch(re);
  });

  it('interpolates set number in rest.logLoad', async () => {
    for (const [lang, re] of [
      ['pt-BR', /série 3/i],
      ['en', /set 3/i],
      ['es', /serie 3/i],
    ] as Array<[SupportedLanguage, RegExp]>) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      const out = t('rest.logLoad', { setNumber: 3 });
      expect(out).toMatch(re);
      expect(out).toContain('3');
      expect(out).not.toContain('{{');
    }
  });

  it('interpolates seconds in rest.addSecondsAccessibility', async () => {
    for (const lang of ['pt-BR', 'en', 'es'] as const) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      const out = t('rest.addSecondsAccessibility', { seconds: 15 });
      expect(out).toContain('15');
      expect(out).not.toContain('{{');
    }
  });
});

describe('workout — PR overlay: previous context + gain per locale', () => {
  it.each([
    ['pt-BR', 60, /anterior 60 kg/i],
    ['en', 60, /previous 60 kg/i],
    ['es', 60, /anterior 60 kg/i],
  ] as Array<[SupportedLanguage, number, RegExp]>)(
    '[%s] record.previousContext prev=%i',
    async (lang, previous, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      const out = t('record.previousContext', {
        exName: 'Supino Reto',
        previous,
        unit: 'kg',
      });
      expect(out).toContain('Supino Reto');
      expect(out).toMatch(re);
    },
  );

  it.each([
    ['pt-BR', 2.5, '+2.5 kg'],
    ['en', 2.5, '+2.5 kg'],
    ['es', 2.5, '+2.5 kg'],
  ] as Array<[SupportedLanguage, number, string]>)(
    '[%s] record.gain(%i)',
    async (lang, delta, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t('record.gain', { delta, unit: 'kg' })).toBe(expected);
    },
  );
});

describe('workout — final metrics per locale', () => {
  it.each([
    ['pt-BR', 'time', 'Tempo'],
    ['en', 'time', 'Time'],
    ['es', 'time', 'Tiempo'],
    ['pt-BR', 'volume', 'Volume'],
    ['en', 'volume', 'Volume'],
    ['es', 'volume', 'Volumen'],
    ['pt-BR', 'sets', 'Séries'],
    ['en', 'sets', 'Sets'],
    ['es', 'sets', 'Series'],
    ['pt-BR', 'newPr', 'Novo PR'],
    ['en', 'newPr', 'New PR'],
    ['es', 'newPr', 'Nuevo PR'],
  ] as Array<[SupportedLanguage, string, string]>)(
    '[%s] done.metrics.%s',
    async (lang, key, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t(`done.metrics.${key}`)).toBe(expected);
    },
  );
});

describe('workout — streak with pluralized days + untilRecord', () => {
  it.each([
    ['pt-BR', 1, '1 dia'],
    ['pt-BR', 15, '15 dias'],
    ['en', 1, '1 day'],
    ['en', 15, '15 days'],
    ['es', 1, '1 día'],
    ['es', 15, '15 días'],
  ] as Array<[SupportedLanguage, number, string]>)(
    '[%s] done.streak.days(%i)',
    async (lang, count, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t('done.streak.days', { count })).toBe(expected);
    },
  );

  it.each([
    ['pt-BR', 1, /^· falta 1 p\/ seu recorde$/],
    ['pt-BR', 6, /^· faltam 6 p\/ seu recorde$/],
    ['en', 1, /^· 1 to your record$/],
    ['en', 6, /^· 6 to your record$/],
    ['es', 1, /^· falta 1 para tu récord$/],
    ['es', 6, /^· faltan 6 para tu récord$/],
  ] as Array<[SupportedLanguage, number, RegExp]>)(
    '[%s] done.streak.untilRecord(%i)',
    async (lang, count, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t('done.streak.untilRecord', { count })).toMatch(re);
    },
  );
});

describe('workout — queue.completedItem plural on total per locale', () => {
  it.each([
    ['pt-BR', 1, /concluído · 1\/1 série/i],
    ['pt-BR', 4, /concluído · 4\/4 séries/i],
    ['en', 1, /done · 1\/1 set/i],
    ['en', 4, /done · 4\/4 sets/i],
    ['es', 1, /hecho · 1\/1 serie/i],
    ['es', 4, /hecho · 4\/4 series/i],
  ] as Array<[SupportedLanguage, number, RegExp]>)(
    '[%s] queue.completedItem total=%i',
    async (lang, total, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(
        t('queue.completedItem', { done: total, total, count: total }),
      ).toMatch(re);
    },
  );
});
