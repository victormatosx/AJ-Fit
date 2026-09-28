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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('quiz runtime — question titles render per locale', () => {
  const CASES: Array<[SupportedLanguage, string, RegExp]> = [
    ['pt-BR', 'sex.title', /sexo/i],
    ['en', 'sex.title', /sex/i],
    ['es', 'sex.title', /sexo/i],
    ['pt-BR', 'goal.title', /objetivo/i],
    ['en', 'goal.title', /goal/i],
    ['es', 'goal.title', /objetivo/i],
    ['pt-BR', 'level.title', /experiência/i],
    ['en', 'level.title', /experience/i],
    ['es', 'level.title', /experiencia/i],
    ['pt-BR', 'days.title', /^Quais dias você quer treinar\?$/i],
    ['en', 'days.title', /^Which days do you want to train\?$/i],
    ['es', 'days.title', /^¿Qué días quieres entrenar\?$/i],
    ['pt-BR', 'place.title', /^Onde você treina\?$/i],
    ['en', 'place.title', /^Where do you train\?$/i],
    ['es', 'place.title', /^¿Dónde entrenas\?$/i],
    ['pt-BR', 'birthDate.title', /nasceu/i],
    ['en', 'birthDate.title', /when.*born/i],
    ['es', 'birthDate.title', /naciste/i],
  ];
  it.each(CASES)('[%s] quiz:%s matches %s', async (lang, path, re) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'quiz' as 'quiz') as unknown as LooseT;
    expect(t(path)).toMatch(re);
  });
});

describe('quiz runtime — birthDate age pluralization', () => {
  // The quiz enforces minAge=16 so `count=0` never renders in production; we
  // test the two branches actually reachable (singular = 1, plural = 25).
  // Portuguese CLDR treats 0 as "one" while English/Spanish treat it as
  // "other" — leaving age(0) untested avoids locking a per-locale CLDR quirk
  // into the suite.
  const CASES: Array<[SupportedLanguage, number, string]> = [
    ['pt-BR', 1, '1 ano'],
    ['pt-BR', 25, '25 anos'],
    ['en', 1, '1 year'],
    ['en', 25, '25 years'],
    ['es', 1, '1 año'],
    ['es', 25, '25 años'],
  ];
  it.each(CASES)('[%s] age(%i) → %s', async (lang, count, expected) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'quiz' as 'quiz') as unknown as LooseT;
    expect(t('birthDate.age', { count })).toBe(expected);
  });
});

describe('quiz runtime — equipment stepLabel interpolation', () => {
  it('interpolates current/total per locale', async () => {
    for (const lang of ['pt-BR', 'en', 'es'] as const) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'quiz' as 'quiz') as unknown as LooseT;
      const label = t('equipment.stepLabel', { current: '10', total: '11' });
      expect(label).toContain('10');
      expect(label).toContain('11');
      // Ensure no raw {{ placeholder }} leaked (interpolation worked)
      expect(label).not.toContain('{{');
    }
  });
});

describe('quiz runtime — options render for every persisted id', () => {
  it.each([
    ['pt-BR', 'goal.options.hyper.label', /hipertrofia/i],
    ['en', 'goal.options.hyper.label', /hypertrophy/i],
    ['es', 'goal.options.hyper.label', /hipertrofia/i],
    ['pt-BR', 'goal.options.gain_muscle.label', /massa muscular/i],
    ['en', 'goal.options.gain_muscle.label', /muscle/i],
    ['es', 'goal.options.gain_muscle.label', /masa muscular/i],
    ['pt-BR', 'goal.options.health.label', /saúde/i],
    ['en', 'goal.options.health.label', /health/i],
    ['es', 'goal.options.health.label', /salud/i],
    ['pt-BR', 'level.options.beg.label', /iniciante/i],
    ['en', 'level.options.beg.label', /beginner/i],
    ['es', 'level.options.beg.label', /principiante/i],
    ['pt-BR', 'level.options.never_or_starting.label', /^iniciante$/i],
    ['en', 'level.options.never_or_starting.label', /^beginner$/i],
    ['es', 'level.options.never_or_starting.label', /^principiante$/i],
    ['pt-BR', 'level.options.beginner.description', /pouca experiência/i],
    ['en', 'level.options.beginner.description', /little experience/i],
    ['es', 'level.options.beginner.description', /poca experiencia/i],
    ['pt-BR', 'level.options.intermediate.description', /regularmente.*principais exercícios/i],
    ['en', 'level.options.intermediate.description', /regularly.*main exercises/i],
    ['es', 'level.options.intermediate.description', /regularmente.*principales ejercicios/i],
    ['pt-BR', 'level.options.advanced.description', /bastante experiência.*domínio/i],
    ['en', 'level.options.advanced.description', /plenty of experience.*mastery/i],
    ['es', 'level.options.advanced.description', /bastante experiencia.*dominio/i],
    ['pt-BR', 'days.flexible.label', /forma livre/i],
    ['en', 'days.flexible.label', /train freely/i],
    ['es', 'days.flexible.label', /entrenar libremente/i],
    ['pt-BR', 'place.options.gym.label', /academia/i],
    ['en', 'place.options.gym.label', /gym/i],
    ['es', 'place.options.gym.label', /gimnasio/i],
    ['pt-BR', 'limits.options.knee', /joelho/i],
    ['en', 'limits.options.knee', /knee/i],
    ['es', 'limits.options.knee', /rodilla/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)(
    '[%s] quiz:%s matches %s',
    async (lang, path, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'quiz' as 'quiz') as unknown as LooseT;
      expect(t(path)).toMatch(re);
    },
  );
});

describe('quiz runtime — equipment catalog labels resolve per locale', () => {
  it.each([
    ['pt-BR', 'equipment.items.dumbbell', /halteres/i],
    ['en', 'equipment.items.dumbbell', /dumbbell/i],
    ['es', 'equipment.items.dumbbell', /mancuernas/i],
    ['pt-BR', 'equipment.items.smith machine', /smith/i],
    ['en', 'equipment.items.smith machine', /smith/i],
    ['es', 'equipment.items.smith machine', /smith/i],
    ['pt-BR', 'equipment.categories.freeWeights', /peso livre/i],
    ['en', 'equipment.categories.freeWeights', /free weights/i],
    ['es', 'equipment.categories.freeWeights', /peso libre/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)(
    '[%s] quiz:%s matches %s',
    async (lang, path, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'quiz' as 'quiz') as unknown as LooseT;
      expect(t(path)).toMatch(re);
    },
  );
});

describe('onboarding runtime — slides + actions per locale', () => {
  it.each([
    ['pt-BR', 'slides.step1.tag', /evolução/i],
    ['en', 'slides.step1.tag', /progress/i],
    ['es', 'slides.step1.tag', /evolución/i],
    ['pt-BR', 'actions.buildPlan', /montar/i],
    ['en', 'actions.buildPlan', /build/i],
    ['es', 'actions.buildPlan', /armar/i],
    ['pt-BR', 'footer.login', /entrar/i],
    ['en', 'footer.login', /sign in/i],
    ['es', 'footer.login', /iniciar/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)(
    '[%s] onboarding:%s matches %s',
    async (lang, path, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'onboarding' as 'onboarding') as unknown as LooseT;
      expect(t(path)).toMatch(re);
    },
  );
});
