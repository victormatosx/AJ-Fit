import type { CurrentTrainingLevel, EvolutionQuality, PendingEvolutionType } from '../workoutLifecycle/types';

/**
 * Semantic journey state — never a raw day count or percentage-to-threshold.
 * Mapped from the Fase 2 decision/reason, never a second eligibility formula.
 */
export type ProximityState = 'BUILDING' | 'ON_TRACK' | 'READY';

export interface ProgressingSummary {
  /** Career/earned level (docs Fase 4 ADR-010) — what the user has actually earned. */
  earnedLevel: CurrentTrainingLevel;
  /** What the active Program Instance is actually prescribed under right now. */
  activeLevel: CurrentTrainingLevel;
  cycleNumber: number;
  /** Semantic state mapped from the engine's own decision/reason. Null means evaluation is temporarily blocked, never guessed. */
  proximity: ProximityState | null;
  /** Real active-day count from Progression V2. Null while an in-progress execution blocks evaluation. */
  activeDays: number | null;
  /** Real completed-session count from Progression V2. Null while evaluation is blocked. */
  sessionsCompleted: number | null;
  /** Engine-classified adherence signal. This is intentionally not converted into a synthetic percentage-to-evolution. */
  adherenceQuality: EvolutionQuality | null;
  /** False when the account is on an unaugmented V1 baseline — copy must not claim "first cycle"/"lifetime cycles" it cannot prove (docs §78/§79/§111). */
  isHistoryComplete: boolean;
}

export interface PendingEvolutionSummary {
  type: PendingEvolutionType;
  quality: EvolutionQuality;
  fromLevel: CurrentTrainingLevel;
  toLevel: CurrentTrainingLevel;
  deferralCount: 0 | 1 | 2;
  nextPromptAt: Date | null;
  autoActivateAt: Date | null;
  /** Real session count for the current cycle AT THE MOMENT the evolution was earned — frozen, never recomputed from later training (docs §92/§93/§141-143). */
  sessionsCompletedAtEarn: number;
}

/**
 * A single discriminated state — impossible combinations (e.g. Motivational
 * Renewal ready + Level Promotion ready at once) cannot be represented,
 * because only one pending evolution can exist at a time (Fase 4, ADR-009)
 * and this type only ever carries that one (docs §140).
 */
export type EvolutionViewModel =
  | { kind: 'LOADING' }
  | { kind: 'UNAVAILABLE' }
  | { kind: 'ERROR'; message: string }
  | { kind: 'PROGRESSING'; summary: ProgressingSummary }
  | { kind: 'EVOLUTION_READY'; summary: ProgressingSummary; pending: PendingEvolutionSummary; canDefer: boolean }
  | { kind: 'EVOLUTION_DEFERRED'; summary: ProgressingSummary; pending: PendingEvolutionSummary }
  | {
      kind: 'AUTO_ACTIVATION_NOTICE';
      summary: ProgressingSummary;
      activatedType: PendingEvolutionType;
      activationEventId: string;
    };
