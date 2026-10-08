import type { CurrentTrainingLevel, EvolutionQuality, PendingEvolutionType } from '../workoutLifecycle/types';

/**
 * Semantic journey state — never a raw day count or percentage-to-threshold.
 * Mapped from the Fase 2 decision/reason, never a second eligibility formula.
 */
export type ProximityState = 'BUILDING' | 'ON_TRACK' | 'READY';

export interface ProgressingSummary {
  /** Career/earned level (docs Fase 4 ADR-010) — what the user has actually earned. */
  earnedLevel: CurrentTrainingLevel | null;
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
  /** Same ratio the engine already computed (`ProgressionDecision.adherence.ratio`), 0-1, capped at 1. Null when `adherenceQuality` is null (evaluation blocked), OR when the summary was reconstructed from the on-disk presentation cache (`presentationCachePolicy.ts`), which never persists this ratio — in that case `adherenceQuality` can still be non-null. */
  adherenceRatio: number | null;
  /** `activeDays` denominator for `activeLevel` — same constant the engine itself uses (`progressionEngineV2/config.ts`), never recomputed as a new rule. Always known (static per level). */
  requiredActiveDays: number;
  /** Local date Active Time paused at (3 consecutive missed prescribed opportunities), or `null` when not paused. Sourced from `ProgressionSnapshotV2.activeTime.pausedAt`. */
  pausedAtLocalDate: string | null;
  /** Earned INTERMEDIATE cycles completed before the one being evaluated — only meaningful for `activeLevel === 'INTERMEDIATE'`. Null when not computed for this load (e.g. BEGINNER/ADVANCED, or evaluation blocked). */
  intermediateCyclesEarned: number | null;
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
  /**
   * Progressive rendering (Fase 5.2) — `summary` is safe and final regardless
   * of what the still-in-flight pending/auto-activation-notice check resolves
   * to (it's computed identically inside every other terminal kind below, see
   * `buildProvisionalEvolutionViewModel`/`buildEvolutionViewModel` in
   * `viewModel.ts`). What ISN'T known yet is whether the load will land on
   * plain `PROGRESSING`, an `EVOLUTION_READY`/`EVOLUTION_DEFERRED` card, or
   * `AUTO_ACTIVATION_NOTICE` — so no action/CTA is ever derived from this
   * kind. `noticeUnavailable` is set only if the remaining check itself then
   * fails: the safe summary stays on screen, but the caller must show the
   * dependent part as unavailable, never as a silently-final ready state.
   */
  | {
      kind: 'SUMMARY_READY';
      summary: ProgressingSummary;
      /** CACHE is presentation-only and can never carry actions; CURRENT_SESSION came from this process's authoritative reads. */
      source: 'CACHE' | 'CURRENT_SESSION';
      noticeUnavailable?: boolean;
    }
  | { kind: 'PROGRESSING'; summary: ProgressingSummary }
  | { kind: 'EVOLUTION_READY'; summary: ProgressingSummary; pending: PendingEvolutionSummary; canDefer: boolean }
  | { kind: 'EVOLUTION_DEFERRED'; summary: ProgressingSummary; pending: PendingEvolutionSummary }
  | {
      kind: 'AUTO_ACTIVATION_NOTICE';
      summary: ProgressingSummary;
      activatedType: PendingEvolutionType;
      activationEventId: string;
    };
