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

/**
 * Phase 7A scope: structural WorkoutScreen text (header accessibility,
 * generic actions, structural modal/overlay copy). Everything set/rep/
 * timer/substitution related belongs to 7B/7C and is deliberately excluded
 * from these assertions — presence of those keys should NOT be tested here
 * because they will only exist after their respective phases.
 */

describe('workout — header + accessibility per locale', () => {
  it.each([
    ['pt-BR', 'header.accessibility.close', /sair do treino/i],
    ['en', 'header.accessibility.close', /exit workout/i],
    ['es', 'header.accessibility.close', /salir del entreno/i],
    ['pt-BR', 'header.accessibility.openQueue', /abrir fila/i],
    ['en', 'header.accessibility.openQueue', /open exercise queue/i],
    ['es', 'header.accessibility.openQueue', /abrir cola/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)('[%s] workout:%s', async (lang, key, re) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
    expect(t(key)).toMatch(re);
  });
});

describe('workout — exit sheet (X → Minimizar/Descartar/Cancelar) per locale', () => {
  it.each([
    ['pt-BR', 'exit.minimize', /minimizar/i],
    ['en', 'exit.minimize', /minimize/i],
    ['es', 'exit.minimize', /minimizar/i],
    ['pt-BR', 'exit.discard', /descartar/i],
    ['en', 'exit.discard', /discard/i],
    ['es', 'exit.discard', /descartar/i],
    ['pt-BR', 'exit.cancel', /cancelar/i],
    ['en', 'exit.cancel', /cancel/i],
    ['es', 'exit.cancel', /cancelar/i],
    ['pt-BR', 'exit.discardConfirmYes', /descartar/i],
    ['en', 'exit.discardConfirmYes', /discard/i],
    ['es', 'exit.discardConfirmYes', /descartar/i],
    ['pt-BR', 'exit.discardConfirmBack', /voltar/i],
    ['en', 'exit.discardConfirmBack', /back/i],
    ['es', 'exit.discardConfirmBack', /volver/i],
    ['pt-BR', 'exit.discardError', /não foi possível/i],
    ['en', 'exit.discardError', /couldn.?t/i],
    ['es', 'exit.discardError', /no se pudo/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)('[%s] workout:%s', async (lang, key, re) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
    expect(t(key)).toMatch(re);
  });
});

describe('workout — main actions per locale', () => {
  it.each([
    ['pt-BR', 'actions.viewExecution', /ver execução/i],
    ['en', 'actions.viewExecution', /see how to/i],
    ['es', 'actions.viewExecution', /cómo hacer/i],
    ['pt-BR', 'actions.swap', /trocar/i],
    ['en', 'actions.swap', /swap/i],
    ['es', 'actions.swap', /cambiar/i],
    ['pt-BR', 'actions.finishWorkout', /finalizar treino/i],
    ['en', 'actions.finishWorkout', /finish workout/i],
    ['es', 'actions.finishWorkout', /finalizar entreno/i],
    ['pt-BR', 'actions.skipBusy', /pular.*aparelho/i],
    ['en', 'actions.skipBusy', /skip.*machine/i],
    ['es', 'actions.skipBusy', /saltar.*máquina/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)('[%s] workout:%s', async (lang, key, re) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
    expect(t(key)).toMatch(re);
  });
});

describe('workout — queue title interpolates exercise count', () => {
  it('interpolates {{count}} per locale without leaving placeholder', async () => {
    for (const lang of ['pt-BR', 'en', 'es'] as const) {
      const i18n = await freshI18nAt(lang);
      const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
      const out = t('queue.title', { count: 8 });
      expect(out).toContain('8');
      expect(out).not.toContain('{{');
    }
  });
});

describe('workout — queue item states per locale', () => {
  it.each([
    ['pt-BR', 'queue.states.now', /agora/i],
    ['en', 'queue.states.now', /now/i],
    ['es', 'queue.states.now', /ahora/i],
    ['pt-BR', 'queue.states.skipped', /pulado/i],
    ['en', 'queue.states.skipped', /skipped/i],
    ['es', 'queue.states.skipped', /saltado/i],
    ['pt-BR', 'queue.states.completed', /concluído/i],
    ['en', 'queue.states.completed', /done/i],
    ['es', 'queue.states.completed', /hecho/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)('[%s] workout:%s', async (lang, key, re) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
    expect(t(key)).toMatch(re);
  });
});

describe('workout — video and exercise-done structural strings per locale', () => {
  it.each([
    ['pt-BR', 'video.execution', /execução/i],
    ['en', 'video.execution', /execution/i],
    ['es', 'video.execution', /ejecución/i],
    ['pt-BR', 'video.keyPoints', /pontos-chave/i],
    ['en', 'video.keyPoints', /key points/i],
    ['es', 'video.keyPoints', /puntos clave/i],
    ['pt-BR', 'exerciseDone.completed', /exercício concluído/i],
    ['en', 'exerciseDone.completed', /exercise complete/i],
    ['es', 'exerciseDone.completed', /ejercicio completado/i],
    ['pt-BR', 'exerciseDone.nextLabel', /próximo/i],
    ['en', 'exerciseDone.nextLabel', /next/i],
    ['es', 'exerciseDone.nextLabel', /siguiente/i],
    ['pt-BR', 'cardioSession.completed', /cardio finalizado/i],
    ['en', 'cardioSession.completed', /cardio finished/i],
    ['es', 'cardioSession.completed', /cardio finalizado/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)('[%s] workout:%s', async (lang, key, re) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
    expect(t(key)).toMatch(re);
  });
});

describe('workout — final "workout done" copy per locale', () => {
  it.each([
    ['pt-BR', 'done.kicker', /treino concluído/i],
    ['en', 'done.kicker', /workout complete/i],
    ['es', 'done.kicker', /entreno completado/i],
    ['pt-BR', 'done.backHome', /voltar para home/i],
    ['en', 'done.backHome', /back to home/i],
    ['es', 'done.backHome', /volver al inicio/i],
  ] as Array<[SupportedLanguage, string, RegExp]>)('[%s] workout:%s', async (lang, key, re) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
    expect(t(key)).toMatch(re);
  });
});

describe('workout — badges reused across UI', () => {
  it.each([
    ['pt-BR', /retomado/i],
    ['en', /resumed/i],
    ['es', /retomado/i],
  ] as Array<[SupportedLanguage, RegExp]>)('[%s] badges.resumed', async (lang, re) => {
    const i18n = await freshI18nAt(lang);
    const t = i18n.getFixedT(lang, 'workout' as 'workout') as unknown as LooseT;
    expect(t('badges.resumed')).toMatch(re);
  });
});
