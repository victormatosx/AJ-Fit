import type { EvolutionViewModel, PendingEvolutionSummary, ProgressingSummary } from '../workoutEvolution/types';
import type { Streak } from './streak';

/**
 * Dev-only preview data for the Home "evolution" surface (HomeEvoTicker +
 * CycleProgressBlock + PendingEvolutionBanner) — never imported by anything
 * that ships to a real user. See `EvolutionDebugPanel.tsx`, the only
 * consumer: a floating `__DEV__`-only button that overrides
 * `evolution.viewModel`/`homeStreak` on Home so every state below can be
 * eyeballed without faking real Firestore/progression data.
 *
 * Numbers here mirror `PROGRESSION_V2_CONFIG` (28 active days for BEGINNER,
 * 85 for INTERMEDIATE/ADVANCED, 70% adherence threshold) purely so the UI
 * looks plausible — they carry no other meaning.
 */

const BASE_SUMMARY: ProgressingSummary = {
  earnedLevel: 'BEGINNER',
  activeLevel: 'BEGINNER',
  cycleNumber: 1,
  proximity: 'BUILDING',
  activeDays: 10,
  sessionsCompleted: 8,
  adherenceQuality: 'GOOD',
  isHistoryComplete: true,
  adherenceRatio: 0.65,
  requiredActiveDays: 28,
  pausedAtLocalDate: null,
  intermediateCyclesEarned: null,
};

function summary(overrides: Partial<ProgressingSummary>): ProgressingSummary {
  return { ...BASE_SUMMARY, ...overrides };
}

const BASE_PENDING: PendingEvolutionSummary = {
  type: 'CYCLE_EVOLUTION',
  quality: 'HIGH',
  fromLevel: 'BEGINNER',
  toLevel: 'BEGINNER',
  deferralCount: 0,
  nextPromptAt: null,
  autoActivateAt: null,
  sessionsCompletedAtEarn: 20,
};

function pending(overrides: Partial<PendingEvolutionSummary>): PendingEvolutionSummary {
  return { ...BASE_PENDING, ...overrides };
}

function fixedStreak(current: number, complete = true): Streak {
  return { scheduleMode: 'fixed', unit: 'obligations', current, complete };
}

export interface EvolutionDebugPreset {
  id: string;
  label: string;
  viewModel: EvolutionViewModel;
  streak: Streak;
}

export const EVOLUTION_DEBUG_PRESETS: readonly EvolutionDebugPreset[] = [
  {
    id: 'high-streak-high-adherence',
    label: 'Sequência alta + aderência alta',
    viewModel: {
      kind: 'PROGRESSING',
      summary: summary({
        activeDays: 24, sessionsCompleted: 22, proximity: 'ON_TRACK',
        adherenceQuality: 'HIGH', adherenceRatio: 0.95,
      }),
    },
    streak: fixedStreak(24),
  },
  {
    id: 'low-adherence',
    label: 'Aderência baixa',
    viewModel: {
      kind: 'PROGRESSING',
      summary: summary({
        activeDays: 10, sessionsCompleted: 7, proximity: 'BUILDING',
        adherenceQuality: 'BELOW_TARGET', adherenceRatio: 0.32,
      }),
    },
    streak: fixedStreak(3),
  },
  {
    id: 'low-streak',
    label: 'Sequência baixa',
    viewModel: {
      kind: 'PROGRESSING',
      summary: summary({
        activeDays: 6, sessionsCompleted: 5, proximity: 'BUILDING',
        adherenceQuality: 'GOOD', adherenceRatio: 0.6,
      }),
    },
    streak: fixedStreak(1),
  },
  {
    id: 'cycle-100-ready',
    label: 'Ciclo 100% concluído (pronto p/ evoluir)',
    viewModel: {
      kind: 'EVOLUTION_READY',
      summary: summary({
        activeDays: 28, sessionsCompleted: 24, proximity: 'READY', adherenceRatio: 0.88,
      }),
      pending: pending({ type: 'CYCLE_EVOLUTION', quality: 'HIGH', sessionsCompletedAtEarn: 24 }),
      canDefer: true,
    },
    streak: fixedStreak(28),
  },
  {
    id: 'level-promotion-ready',
    label: 'Pronto p/ novo nível (promoção)',
    viewModel: {
      kind: 'EVOLUTION_READY',
      summary: summary({
        activeLevel: 'INTERMEDIATE', earnedLevel: 'INTERMEDIATE', requiredActiveDays: 85,
        activeDays: 85, sessionsCompleted: 60, proximity: 'READY', adherenceRatio: 0.82,
      }),
      pending: pending({ type: 'LEVEL_PROMOTION', quality: 'HIGH', fromLevel: 'INTERMEDIATE', toLevel: 'ADVANCED' }),
      canDefer: true,
    },
    streak: fixedStreak(40),
  },
  {
    id: 'motivational-renewal-ready',
    label: 'Renovação motivacional pronta',
    viewModel: {
      kind: 'EVOLUTION_READY',
      summary: summary({ proximity: 'READY', adherenceRatio: 0.7 }),
      pending: pending({ type: 'MOTIVATIONAL_RENEWAL', quality: 'GOOD' }),
      canDefer: true,
    },
    streak: fixedStreak(15),
  },
  {
    id: 'evolution-deferred',
    label: 'Evolução adiada',
    viewModel: {
      kind: 'EVOLUTION_DEFERRED',
      summary: summary({ proximity: 'READY', adherenceRatio: 0.85 }),
      pending: pending({
        type: 'CYCLE_EVOLUTION',
        quality: 'HIGH',
        deferralCount: 1,
        nextPromptAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        autoActivateAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      }),
    },
    streak: fixedStreak(12),
  },
  {
    id: 'paused',
    label: 'Progresso pausado',
    viewModel: {
      kind: 'PROGRESSING',
      summary: summary({
        activeDays: 14, sessionsCompleted: 11, adherenceRatio: 0.5,
        pausedAtLocalDate: '2026-09-20',
      }),
    },
    streak: fixedStreak(0),
  },
  {
    id: 'intermediate-toward-advanced',
    label: 'Intermediário rumo ao avançado (3/4 ciclos)',
    viewModel: {
      kind: 'PROGRESSING',
      summary: summary({
        activeLevel: 'INTERMEDIATE', earnedLevel: 'INTERMEDIATE', requiredActiveDays: 85,
        activeDays: 60, sessionsCompleted: 44, proximity: 'ON_TRACK', adherenceRatio: 0.8,
        intermediateCyclesEarned: 3,
      }),
    },
    streak: fixedStreak(18),
  },
  {
    id: 'auto-activation-notice',
    label: 'Notificação de auto-ativação',
    viewModel: {
      kind: 'AUTO_ACTIVATION_NOTICE',
      summary: summary({ activeDays: 28, sessionsCompleted: 24, adherenceRatio: 0.9, cycleNumber: 2 }),
      activatedType: 'CYCLE_EVOLUTION',
      activationEventId: 'debug-preset-event',
    },
    streak: fixedStreak(30),
  },
  {
    id: 'loading',
    label: 'Carregando',
    viewModel: { kind: 'LOADING' },
    streak: fixedStreak(0),
  },
  {
    id: 'error',
    label: 'Erro',
    viewModel: { kind: 'ERROR', message: 'Falha de teste (debug)' },
    streak: fixedStreak(0),
  },
  {
    id: 'unavailable',
    label: 'Indisponível',
    viewModel: { kind: 'UNAVAILABLE' },
    streak: fixedStreak(0),
  },
];
