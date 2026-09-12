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
 * Phase 7C runtime coverage — substitution flow, exercise catalog names,
 * muscle-group labels, video-modal bullets, and the combined queue item.
 *
 * Fallback behavior (missing db key / missing target mapping) is not tested
 * here because the resource parity test already forbids missing leaves; the
 * fallback exists as defensive code for legacy persisted subs, not as a
 * runtime path with a known input.
 */

describe('workout — substitution sheet copy per locale', () => {
  it.each([
    ['pt-BR', 'substitution.sheetTitle', /trocar exercício/i],
    ['en', 'substitution.sheetTitle', /swap exercise/i],
    ['es', 'substitution.sheetTitle', /cambiar ejercicio/i],
    ['pt-BR', 'substitution.sheetSubtitle', /mesmo grupo muscular/i],
    ['en', 'substitution.sheetSubtitle', /same muscle group/i],
    ['es', 'substitution.sheetSubtitle', /mismo grupo muscular/i],
    ['pt-BR', 'substitution.confirmTitle', /aplicar troca/i],
    ['en', 'substitution.confirmTitle', /apply swap/i],
    ['es', 'substitution.confirmTitle', /aplicar cambio/i],
    ['pt-BR', 'substitution.loading', 'Carregando substituições...'],
    ['en', 'substitution.loading', 'Loading substitutions...'],
    ['es', 'substitution.loading', 'Cargando sustituciones...'],
    ['pt-BR', 'substitution.empty', 'Não há substituições disponíveis para este exercício.'],
    ['en', 'substitution.empty', 'No substitutions are available for this exercise.'],
    ['es', 'substitution.empty', 'No hay sustituciones disponibles para este ejercicio.'],
    ['pt-BR', 'substitution.loadError', 'Não foi possível carregar as substituições.'],
    ['en', 'substitution.loadError', "Couldn't load substitutions."],
    ['es', 'substitution.loadError', 'No se pudieron cargar las sustituciones.'],
  ] as Array<[SupportedLanguage, string, string | RegExp]>)('[%s] workout:%s', async (lang, key, expected) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
    if (typeof expected === 'string') expect(t(key)).toBe(expected);
    else expect(t(key)).toMatch(expected);
  });
});

describe('workout — substitution labels + actions per locale', () => {
  it.each([
    ['pt-BR', 'substitution.labels.original', 'Original'],
    ['en', 'substitution.labels.original', 'Original'],
    ['es', 'substitution.labels.original', 'Original'],
    ['pt-BR', 'substitution.labels.replacement', 'Substituição'],
    ['en', 'substitution.labels.replacement', 'Substitution'],
    ['es', 'substitution.labels.replacement', 'Sustitución'],
    ['pt-BR', 'substitution.labels.current', 'Atual'],
    ['en', 'substitution.labels.current', 'Current'],
    ['es', 'substitution.labels.current', 'Actual'],
    ['pt-BR', 'substitution.actions.once', 'Trocar só dessa vez'],
    ['en', 'substitution.actions.once', 'Swap just this time'],
    ['es', 'substitution.actions.once', 'Cambiar solo esta vez'],
    ['pt-BR', 'substitution.actions.permanent', 'Trocar em todo o treino'],
    ['en', 'substitution.actions.permanent', 'Swap for the whole plan'],
    ['es', 'substitution.actions.permanent', 'Cambiar en todo el plan'],
    ['pt-BR', 'substitution.actions.retry', 'Tentar novamente'],
    ['en', 'substitution.actions.retry', 'Try again'],
    ['es', 'substitution.actions.retry', 'Intentar de nuevo'],
    ['pt-BR', 'substitution.actions.cancel', 'Cancelar'],
    ['en', 'substitution.actions.cancel', 'Cancel'],
    ['es', 'substitution.actions.cancel', 'Cancelar'],
  ] as Array<[SupportedLanguage, string, string]>)(
    '[%s] workout:%s = %s',
    async (lang, key, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t(key)).toBe(expected);
    },
  );
});

describe('workout — substitution.replaceQuestion interpolates both names per locale', () => {
  it.each([
    ['pt-BR', 'Supino Máquina no lugar de Supino Reto.'],
    ['en', 'Machine bench press instead of Bench press.'],
    ['es', 'Prensa banca en lugar de Press.'],
  ] as Array<[SupportedLanguage, string]>)(
    '[%s] fully composed sentence',
    async (lang, contains) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      // Use short synthetic names so the test doesn't depend on the exact
      // catalog wording (which lives in a separate assertion below).
      const out = t('substitution.replaceQuestion', {
        replacement: lang === 'pt-BR' ? 'Supino Máquina' : lang === 'en' ? 'Machine bench press' : 'Prensa banca',
        original: lang === 'pt-BR' ? 'Supino Reto' : lang === 'en' ? 'Bench press' : 'Press',
      });
      expect(out).toBe(contains);
    },
  );
});

describe('workout — substitution badges per locale', () => {
  it.each([
    ['pt-BR', 'today', /trocado hoje/i],
    ['en', 'today', /swapped today/i],
    ['es', 'today', /cambiado hoy/i],
    ['pt-BR', 'permanent', /trocado fixo/i],
    ['en', 'permanent', /swap saved/i],
    ['es', 'permanent', /cambio fijo/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)(
    '[%s] badges.%s',
    async (lang, key, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t(`substitution.badges.${key}`)).toMatch(re);
    },
  );
});

describe('workout — muscle groups per locale', () => {
  // `muscleGroups.*` is keyed directly by the canonical `MuscleId`
  // (`src/types/exercise.ts`) — the same value `workoutExercisesFromPlan`
  // reads straight off the exercise catalog's `target.primaryMuscle`. Every
  // `MuscleId` must have an entry here or `translateMuscleGroup` falls back
  // to the raw id (see `resourceParity.test.ts` for the no-empty-leaf half
  // of this guarantee; this exercises the actual display text).
  const MUSCLE_IDS: Array<[string, string, string, string]> = [
    ['chest', 'Peitoral', 'Chest', 'Pecho'],
    ['lats', 'Dorsal', 'Lats', 'Dorsales'],
    ['upper_back', 'Costas superiores', 'Upper back', 'Espalda superior'],
    ['traps', 'Trapézio', 'Traps', 'Trapecio'],
    ['lower_back', 'Lombar', 'Lower back', 'Zona lumbar'],
    ['front_deltoid', 'Ombro frontal', 'Front delt', 'Deltoides anterior'],
    ['side_deltoid', 'Ombro lateral', 'Side delt', 'Deltoides lateral'],
    ['rear_deltoid', 'Ombro posterior', 'Rear delt', 'Deltoides posterior'],
    ['biceps', 'Bíceps', 'Biceps', 'Bíceps'],
    ['triceps', 'Tríceps', 'Triceps', 'Tríceps'],
    ['forearms', 'Antebraço', 'Forearms', 'Antebrazo'],
    ['quads', 'Quadríceps', 'Quads', 'Cuádriceps'],
    ['hamstrings', 'Posterior de coxa', 'Hamstrings', 'Isquiotibiales'],
    ['glutes', 'Glúteos', 'Glutes', 'Glúteos'],
    ['adductors', 'Adutores', 'Adductors', 'Aductores'],
    ['abductors', 'Abdutores', 'Abductors', 'Abductores'],
    ['calves', 'Panturrilha', 'Calves', 'Pantorrillas'],
    ['abs', 'Abdômen', 'Abs', 'Abdomen'],
  ];

  it.each(
    MUSCLE_IDS.flatMap(([key, ptBR, en, es]) => [
      ['pt-BR', key, ptBR],
      ['en', key, en],
      ['es', key, es],
    ]) as Array<[SupportedLanguage, string, string]>,
  )(
    '[%s] muscleGroups.%s',
    async (lang, key, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t(`muscleGroups.${key}`)).toBe(expected);
    },
  );
});

describe('workout — exercises catalog covers every db used by EXERCISES + subs', () => {
  // The full list of `db` identifiers referenced by the WorkoutScreen
  // catalog (base + subs). Any exercise removed from the JSON here would
  // fall through to the fallback (PT catalog name); this test locks that
  // there IS a translation for every catalog row in every locale.
  const CATALOG_DBS = [
    'Barbell_Bench_Press_-_Medium_Grip',
    'Dumbbell_Bench_Press',
    'Machine_Bench_Press',
    'Incline_Dumbbell_Bench_With_Palms_Facing_In',
    'Barbell_Incline_Bench_Press_Medium-Grip',
    'Low_Cable_Crossover',
    'Cable_Crossover',
    'Dumbbell_Flyes',
    'Butterfly',
    'Standing_Military_Press',
    'Dumbbell_Shoulder_Press',
    'Arnold_Dumbbell_Press',
    'Side_Lateral_Raise',
    'Cable_Shoulder_Press',
    'Front_Dumbbell_Raise',
    'Triceps_Pushdown',
    'Tricep_Dumbbell_Kickback',
    'Barbell_Skullcrusher_Extension',
    'EZ-Bar_Skullcrusher',
    'Seated_Dumbbell_Tricep_Press',
    'Dips_-_Triceps_Version',
    'Weighted_Bench_Dip',
    'Close-Grip_Push-Up_off_of_a_Wall',
  ];

  it.each(['pt-BR', 'en', 'es'] as const)('%s: all 23 exercises translate to non-empty strings', async (lang) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
    for (const db of CATALOG_DBS) {
      const value = t(`exercises.${db}`, { defaultValue: '' });
      expect(value, `[${lang}] missing translation for exercises.${db}`).not.toBe('');
      // The fallback path returns the raw key when i18next can't resolve —
      // ensure the value is NOT the key itself.
      expect(value).not.toBe(`exercises.${db}`);
    }
  });

  it.each([
    ['pt-BR', 'Barbell_Bench_Press_-_Medium_Grip', /supino reto/i],
    ['en', 'Barbell_Bench_Press_-_Medium_Grip', /barbell bench press/i],
    ['es', 'Barbell_Bench_Press_-_Medium_Grip', /press de banca/i],
    ['pt-BR', 'EZ-Bar_Skullcrusher', /tríceps francês/i],
    ['en', 'EZ-Bar_Skullcrusher', /french press/i],
    ['es', 'EZ-Bar_Skullcrusher', /press francés/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)(
    '[%s] exercises.%s',
    async (lang, db, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t(`exercises.${db}`)).toMatch(re);
    },
  );
});

describe('workout — video modal key-point bullets per locale', () => {
  it.each([
    ['pt-BR', 'keyPoint1', /escápula/i],
    ['en', 'keyPoint1', /shoulder blades/i],
    ['es', 'keyPoint1', /escápulas/i],
    ['pt-BR', 'keyPoint2', /excêntrica/i],
    ['en', 'keyPoint2', /eccentric/i],
    ['es', 'keyPoint2', /excéntrica/i],
    ['pt-BR', 'keyPoint3', /cotovelos/i],
    ['en', 'keyPoint3', /elbows/i],
    ['es', 'keyPoint3', /codos/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)(
    '[%s] instructions.default.%s',
    async (lang, key, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      expect(t(`instructions.default.${key}`)).toMatch(re);
    },
  );
});

describe('workout — queue.activeItem combines target + progress in one key', () => {
  it.each([
    ['pt-BR', 'Peitoral', 4, /peitoral · 2\/4 séries/i],
    ['pt-BR', 'Peitoral', 1, /peitoral · 0\/1 série/i],
    ['en', 'Chest', 4, /chest · 2\/4 sets/i],
    ['en', 'Chest', 1, /chest · 0\/1 set/i],
    ['es', 'Pecho', 4, /pecho · 2\/4 series/i],
    ['es', 'Pecho', 1, /pecho · 0\/1 serie/i],
  ] as Array<[SupportedLanguage, string, number, RegExp]>)(
    '[%s] target=%s total=%i',
    async (lang, target, total, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      const done = total === 1 ? 0 : 2;
      expect(t('queue.activeItem', { target, done, total, count: total })).toMatch(re);
    },
  );
});
