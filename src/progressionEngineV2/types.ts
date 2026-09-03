import type { Adherence, ActiveTime, CurrentTrainingLevel, EvolutionQuality } from '../workoutLifecycle/types';

/** Typed, non-user-facing reason codes for debug/telemetry (docs §41 — never shown as copy). */
export type ProgressionReasonCode =
  | 'IN_PROGRESS_EXECUTION'
  | 'MINIMUM_ACTIVE_TIME_NOT_REACHED'
  | 'ADHERENCE_BELOW_THRESHOLD'
  | 'EARNED_CYCLE_READY'
  | 'LEVEL_PROMOTION_READY'
  | 'MOTIVATIONAL_EXTENSION_REACHED';

/**
 * Everything the pure evaluator needs, already gathered and computed by the
 * caller (Session Qualification → Adherence → Active Time → Cycle Progress
 * all happen before this). The evaluator itself only decides eligibility.
 */
export interface ProgressionSnapshotV2 {
  level: CurrentTrainingLevel;
  activeTime: ActiveTime;
  adherence: Adherence;
  /**
   * Earned INTERMEDIATE cycles completed strictly before the cycle currently
   * being evaluated. Ignored for BEGINNER/ADVANCED. Never inflated by
   * Motivational Renewals, Program Adaptations, or V1-inferred history
   * (docs §34/§35).
   */
  earnedIntermediateCycleCount: number;
  /** An IN_PROGRESS execution always blocks a decision (docs §9/§42). */
  hasInProgressExecution: boolean;
  /** Fase 5 — real completed-session count for this cycle, surfaced read-only for UI (docs product §11/§24). Never used by the evaluator's own logic. */
  validSessionCount: number;
}

/**
 * Discriminated union — a decision can never simultaneously claim earned
 * eligibility and a motivational renewal, because only one variant of this
 * type can ever be returned (docs §39/§40).
 */
export type ProgressionDecision =
  | { type: 'NO_ACTION'; reason: ProgressionReasonCode }
  | {
      type: 'PROGRESS_CONTINUES';
      reason: ProgressionReasonCode;
      activeDays: number;
      adherence: Adherence;
      validSessionCount: number;
    }
  | {
      type: 'EVOLUTION_ELIGIBLE';
      level: CurrentTrainingLevel;
      quality: EvolutionQuality;
      activeDays: number;
      adherence: Adherence;
      reason: ProgressionReasonCode;
      validSessionCount: number;
    }
  | {
      type: 'MOTIVATIONAL_RENEWAL_AVAILABLE';
      level: CurrentTrainingLevel;
      activeDays: number;
      adherence: Adherence;
      reason: ProgressionReasonCode;
      validSessionCount: number;
    }
  | {
      type: 'LEVEL_PROMOTION_ELIGIBLE';
      from: CurrentTrainingLevel;
      to: CurrentTrainingLevel;
      quality: EvolutionQuality;
      activeDays: number;
      adherence: Adherence;
      reason: ProgressionReasonCode;
      validSessionCount: number;
    };
