/**
 * Progression Engine V1 (docs/workout-lifecycle/04_PROGRESSION_ENGINE.md).
 * Decides WHEN a Program Snapshot should evolve — Beginner stage transitions
 * (1→2→3) and, once at full training, a ~90-day normal renewal cycle. Never
 * chooses Txxx and never touches load/reps/sets — that stays the Prescription
 * Engine's job; this engine only orchestrates WHEN to ask it to run again.
 */

export type AdaptationStage = 1 | 2 | 3;

/** Minimum elapsed days before a Beginner stage can advance (docs §19). */
export const BEGINNER_STAGE_MIN_DAYS = 7;

/** Approximate normal-program renewal cycle (docs §30) — centralized so `90` never gets hardcoded elsewhere. */
export const NORMAL_PROGRAM_CYCLE_DAYS = 90;

/** Minimum adherence (completed+partial / expected sessions) for normal rotation (docs §33). */
export const NORMAL_ADHERENCE_THRESHOLD = 0.6;

export const PROGRESSION_ENGINE_VERSION = 1;

export type ProgressionEventType = 'BEGINNER_STAGE_TRANSITION' | 'NORMAL_ROTATION';

export type NotEligibleReasonCode =
  | 'MINIMUM_TIME_NOT_REACHED'
  | 'MINIMUM_SESSIONS_NOT_REACHED'
  | 'PROGRAM_AGE_NOT_REACHED'
  | 'ADHERENCE_TOO_LOW';

export type ProgressionResolution =
  | { status: 'INVALID_PROGRAM_STATE' }
  | { status: 'BLOCKED_ACTIVE_EXECUTION' }
  | { status: 'NOT_ELIGIBLE'; reasonCodes: NotEligibleReasonCode[] }
  | { status: 'BEGINNER_STAGE_PROGRESSION_AVAILABLE'; fromStage: 1 | 2; toStage: 2 | 3 }
  | { status: 'NORMAL_ROTATION_AVAILABLE' };

export interface EvaluateWorkoutProgressionInput {
  /** Whether the currently-active program is a structurally valid, evaluable program. */
  hasValidActiveProgram: boolean;
  /** `program.adaptationStage` — `undefined` means the user never went through Beginner Adaptation (intermediate/advanced from day one). */
  adaptationStage: AdaptationStage | undefined;
  /** Local date (YYYY-MM-DD) the active program was activated. */
  activatedAtLocalDate: string;
  /** Local "today", already resolved in the user's timezone by the caller. */
  todayLocalDate: string;
  /** `scheduleConfig.trainingDays.length` — the weekly frequency this program was scheduled at. */
  trainingDaysPerWeek: number;
  /** COMPLETED + PARTIALLY_COMPLETED executions for THIS programId only (docs §17/§67/§68/§87). */
  completedOrPartialSessionCount: number;
  /** Any IN_PROGRESS execution for this programId — blocks a transition regardless of eligibility (docs §23/§36/§72). */
  hasActiveExecution: boolean;
}
