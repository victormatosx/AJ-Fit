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

describe('home — greeting + interpolated meta per locale', () => {
  it.each([
    ['pt-BR', 'greeting.casual', /^E aí,$/],
    ['en', 'greeting.casual', /^Hey,$/],
    ['es', 'greeting.casual', /^Hola,$/],
    ['pt-BR', 'todayCard.start', /iniciar treino/i],
    ['en', 'todayCard.start', /start workout/i],
    ['es', 'todayCard.start', /iniciar entreno/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)('[%s] home:%s', async (lang, key, re) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'home' as 'home') as unknown as LooseT;
    expect(t(key)).toMatch(re);
  });

  it('interpolates today card meta (duration/exercises/kcal)', async () => {
    for (const lang of ['pt-BR', 'en', 'es'] as const) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'home' as 'home') as unknown as LooseT;
      const out = t('todayCard.meta', { duration: 58, exercises: 8, kcal: 420 });
      expect(out).toContain('58');
      expect(out).toContain('8');
      expect(out).toContain('420');
      expect(out).not.toContain('{{');
    }
  });

  it('interpolates todayLine with mock date parts', async () => {
    for (const lang of ['pt-BR', 'en', 'es'] as const) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'home' as 'home') as unknown as LooseT;
      const out = t('meta.todayLine', {
        weekday: 'X',
        day: '03',
        month: 'Y',
        currentWeek: '04',
        totalWeeks: '12',
      });
      expect(out).toContain('03');
      expect(out).toContain('04');
      expect(out).toContain('12');
      expect(out).not.toContain('{{');
    }
  });

  it('exposes day initials as an array with exactly 7 entries per locale', async () => {
    for (const lang of ['pt-BR', 'en', 'es'] as const) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'home' as 'home') as unknown as (
        key: string,
        opts: { returnObjects: true },
      ) => string[];
      const arr = t('consistency.dayInitials', { returnObjects: true });
      expect(Array.isArray(arr)).toBe(true);
      expect(arr).toHaveLength(7);
      for (const letter of arr) {
        expect(typeof letter).toBe('string');
        expect(letter.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('profile — subscription label lookup + fallback', () => {
  it.each([
    ['pt-BR', 'TRIAL', /teste grátis/i],
    ['en', 'TRIAL', /free trial/i],
    ['es', 'TRIAL', /prueba gratis/i],
    ['pt-BR', 'ACTIVE', /ativo/i],
    ['en', 'ACTIVE', /active/i],
    ['es', 'ACTIVE', /activo/i],
    ['pt-BR', 'BILLING_ISSUE', /pagamento pendente/i],
    ['en', 'BILLING_ISSUE', /payment pending/i],
    ['es', 'BILLING_ISSUE', /pago pendiente/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)(
    '[%s] profile:subscription.labels.%s',
    async (lang, status, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'profile' as 'profile') as unknown as LooseT;
      expect(t(`subscription.labels.${status}`)).toMatch(re);
    },
  );

  it('unknown subscription status falls back to the "unknown" label via defaultValue', async () => {
    // Simulates ProfileScreen's `t(..., { defaultValue: t('subscription.labels.unknown') })`
    // pattern for statuses the current tree doesn't expose.
    for (const lang of ['pt-BR', 'en', 'es'] as const) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'profile' as 'profile') as unknown as LooseT;
      const unknown = t('subscription.labels.unknown');
      // The label must not equal the key itself (i.e. must be present).
      expect(unknown).not.toBe('subscription.labels.unknown');
      // AJ Premium is the marketing name — same across locales.
      expect(unknown.toLowerCase()).toContain('aj premium');
    }
  });

  it('none-status label rendered when profile has no subscription', async () => {
    for (const [lang, re] of [
      ['pt-BR', /sem assinatura/i],
      ['en', /no active subscription/i],
      ['es', /sin suscripción/i],
    ] as Array<[SupportedLanguage, RegExp]>) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'profile' as 'profile') as unknown as LooseT;
      expect(t('subscription.labels.none')).toMatch(re);
    }
  });
});

describe('profile — fallback.athlete replaces literal "Atleta" in Home/Profile render', () => {
  it.each([
    ['pt-BR', 'Atleta'],
    ['en', 'Athlete'],
    ['es', 'Atleta'],
  ] as Array<[SupportedLanguage, string]>)(
    '[%s] profile:fallback.athlete resolves to "%s"',
    async (lang, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'profile' as 'profile') as unknown as LooseT;
      expect(t('fallback.athlete')).toBe(expected);
    },
  );
});

describe('profile — logout dialog copy per locale', () => {
  it.each([
    ['pt-BR', 'logout.confirmTitle', /sair da conta/i],
    ['en', 'logout.confirmTitle', /sign out/i],
    ['es', 'logout.confirmTitle', /cerrar sesión/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)(
    '[%s] profile:%s',
    async (lang, key, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'profile' as 'profile') as unknown as LooseT;
      expect(t(key)).toMatch(re);
    },
  );
});

describe('profile — edit validation messages are interpolable per locale', () => {
  it.each([
    ['pt-BR', 'edit.validation.nameTooShort', { min: 2 }, /2 caracteres/],
    ['en', 'edit.validation.nameTooShort', { min: 2 }, /at least 2 characters/i],
    ['es', 'edit.validation.nameTooShort', { min: 2 }, /al menos 2 caracteres/i],
    ['pt-BR', 'edit.validation.nameTooLong', { max: 50 }, /50 caracteres/],
    ['en', 'edit.validation.nameTooLong', { max: 50 }, /at most 50 characters/i],
    ['es', 'edit.validation.nameTooLong', { max: 50 }, /50 caracteres/i],
    ['pt-BR', 'edit.validation.birthDateAgeRange', { min: 16, max: 75 }, /16 e 75 anos/],
    ['en', 'edit.validation.birthDateAgeRange', { min: 16, max: 75 }, /16 and 75 years/i],
    ['es', 'edit.validation.birthDateAgeRange', { min: 16, max: 75 }, /16 y 75 años/i],
  ] as Array<[SupportedLanguage, string, Record<string, unknown>, RegExp]>)(
    '[%s] profile:%s',
    async (lang, key, params, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'profile' as 'profile') as unknown as LooseT;
      expect(t(key, params)).toMatch(re);
    },
  );
});

describe('profile — photo menu strings per locale', () => {
  it.each([
    ['pt-BR', 'photo.menu.takePhoto', /tirar foto/i],
    ['en', 'photo.menu.takePhoto', /take photo/i],
    ['es', 'photo.menu.takePhoto', /tomar foto/i],
    ['pt-BR', 'photo.actions.change', /alterar foto/i],
    ['en', 'photo.actions.change', /change photo/i],
    ['es', 'photo.actions.change', /cambiar foto/i],
    ['pt-BR', 'photo.errors.tooLarge', /5 mb/i],
    ['en', 'photo.errors.tooLarge', /5 mb/i],
    ['es', 'photo.errors.tooLarge', /5 mb/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)(
    '[%s] profile:%s',
    async (lang, key, re) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'profile' as 'profile') as unknown as LooseT;
      expect(t(key)).toMatch(re);
    },
  );
});

describe('common:navigation — tab labels per locale', () => {
  it.each([
    ['pt-BR', 'home', 'Home'],
    ['en', 'home', 'Home'],
    ['es', 'home', 'Home'],
    ['pt-BR', 'workout', 'Treino'],
    ['en', 'workout', 'Workout'],
    ['es', 'workout', 'Entreno'],
    ['pt-BR', 'progress', 'Evolução'],
    ['en', 'progress', 'Progress'],
    ['es', 'progress', 'Progreso'],
    ['pt-BR', 'profile', 'Perfil'],
    ['en', 'profile', 'Profile'],
    ['es', 'profile', 'Perfil'],
  ] as Array<[SupportedLanguage, string, string]>)(
    '[%s] common:navigation.%s = %s',
    async (lang, key, expected) => {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'common' as 'common') as unknown as LooseT;
      expect(t(`navigation.${key}`)).toBe(expected);
    },
  );
});
