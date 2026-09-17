/**
 * Workout Lifecycle V2 domain contracts.
 *
 * This module is intentionally persistence-agnostic. It models lifecycle
 * facts only; prescription rules, XP/rewards and the V2 progression policy
 * live outside this boundary.
 */

export const WORKOUT_LIFECYCLE_SCHEMA_VERSION = 2;
export const PRESCRIPTION_INPUT_SNAPSHOT_SCHEMA_VERSION = 1;

export type StartingLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type CurrentTrainingLevel = StartingLevel;

export type TrainingCycleStatus = 'ACTIVE' | 'COMPLETED';
export type TrainingCycleOrigin = 'V2_NATIVE' | 'V1_MIGRATION_BASELINE';
export type TrainingCycleCompletionReason = 'EARNED_EVOLUTION';

export type PrescriptionInputSnapshotSource =
  | 'QUESTIONNAIRE_BASELINE'
  | 'PROGRAM_ADAPTATION'
  | 'LEVEL_PROMOTION'
  | 'CYCLE_EVOLUTION'
  | 'MOTIVATIONAL_RENEWAL';

/**
 * Minimal, prescription-relevant input projection. Onboarding-only fields
 * (motivation/commitment) and profile/identity data are deliberately absent.
 * The nested screening shapes reuse the questionnaire contracts without
 * turning the historical questionnaire itself into mutable lifecycle state.
 */
export interface EffectivePrescriptionInputs {
  sex: import('../state/AppState').Quiz['sex'];
  goal: import('../state/AppState').Quiz['goal'];
  level: import('../state/AppState').Quiz['level'];
  limits: import('../state/AppState').Quiz['limits'];
  duration: import('../state/AppState').Quiz['duration'];
  days: import('../state/AppState').Quiz['days'];
  /** Absent only in legacy persisted snapshots and read as `fixed`. */
  scheduleMode?: import('../state/AppState').ScheduleMode;
  trainingDays: import('../state/AppState').Quiz['trainingDays'];
  place: import('../state/AppState').Quiz['place'];
  primaryPlace: import('../state/AppState').Quiz['primaryPlace'];
  equipment: import('../state/AppState').Quiz['equipment'];
  style: import('../state/AppState').Quiz['style'];
  muscleFocus: import('../state/AppState').Quiz['muscleFocus'];
  specialConditions: import('../state/AppState').Quiz['specialConditions'];
  pregnancyScreening: import('../state/AppState').Quiz['pregnancyScreening'];
  postpartumScreening: import('../state/AppState').Quiz['postpartumScreening'];
  functionalScreening: import('../state/AppState').Quiz['functionalScreening'];
  lipedemaScreening: import('../state/AppState').Quiz['lipedemaScreening'];
  dizzinessScreening: import('../state/AppState').Quiz['dizzinessScreening'];
  postSurgicalScreening: import('../state/AppState').Quiz['postSurgicalScreening'];
  medicalRestrictionScreening: import('../state/AppState').Quiz['medicalRestrictionScreening'];
}

export interface PrescriptionInputSnapshot {
  snapshotId: string;
  schemaVersion: typeof PRESCRIPTION_INPUT_SNAPSHOT_SCHEMA_VERSION;
  source: PrescriptionInputSnapshotSource;
  inputs: EffectivePrescriptionInputs;
}

export interface TrainingCycle<TTimestamp = unknown> {
  cycleId: string;
  level: CurrentTrainingLevel;
  cycleNumber: number;
  status: TrainingCycleStatus;
  origin: TrainingCycleOrigin;
  programInstanceId: string;
  previousProgramInstanceId: string | null;
  startedAt: TTimestamp;
  eligibleAt: TTimestamp | null;
  completedAt: TTimestamp | null;
  /** Why this cycle ended. Absent only on pre-8A V2 documents. */
  completionReason?: TrainingCycleCompletionReason | null;
  progressionReason: string;
  schemaVersion: typeof WORKOUT_LIFECYCLE_SCHEMA_VERSION;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}

export type ProgramInstanceActivationReason =
  | 'INITIAL_PROGRAM'
  | 'V1_MIGRATION_BASELINE'
  | 'V1_AUTOMATIC_PROGRESSION'
  | 'MANUAL_REGENERATION'
  | 'AUTOMATIC_RECONCILIATION'
  /** A Fase 2/3 earned or offered evolution (Cycle Evolution, Level Promotion, or Motivational Renewal) becoming the active Program Instance. */
  | 'EVOLUTION_ACTIVATION'
  /** An explicit Program Adaptation — prescription inputs changed; never an earned transition. */
  | 'PROGRAM_ADAPTATION';

export interface ProgramInstance<TTimestamp = unknown> {
  programInstanceId: string;
  cycleId: string;
  /** Existing deterministic WorkoutProgram identity; retained as content identity. */
  contentIdentity: string;
  /** Existing deterministic FinalWorkoutPlan.planId. */
  prescriptionIdentity: string;
  questionnaireId: string;
  /** Immutable effective inputs used to generate this exact ProgramInstance. Absent only on pre-8A/legacy history. */
  prescriptionInputSnapshot?: PrescriptionInputSnapshot;
  activatedAt: TTimestamp;
  supersededAt: TTimestamp | null;
  previousProgramInstanceId: string | null;
  activationReason: ProgramInstanceActivationReason;
  schemaVersion: typeof WORKOUT_LIFECYCLE_SCHEMA_VERSION;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}

export interface WorkoutLifecycle<TTimestamp = unknown> {
  startingLevel: StartingLevel;
  currentTrainingLevel: CurrentTrainingLevel;
  currentCycleId: string;
  currentCycleNumber: number;
  activeProgramInstanceId: string;
  activeContentIdentity: string;
  activePrescriptionIdentity: string;
  initializationOrigin: TrainingCycleOrigin;
  /** History before this instant may be incomplete for a V1 baseline. */
  historyCompleteFrom: TTimestamp;
  schemaVersion: typeof WORKOUT_LIFECYCLE_SCHEMA_VERSION;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}

export interface CycleProgress {
  activeDays: number;
  expectedSessions: number;
  validCompletedSessions: number;
  adherence: Adherence;
  evolutionEligibility: EvolutionEligibility;
  deferral: EvolutionDeferral;
}

export interface ActiveTime {
  activeDays: number;
  pausedAt: unknown | null;
}

export interface Adherence {
  ratio: number;
  quality: EvolutionQuality;
}

export type EvolutionEligibility =
  | 'NOT_ELIGIBLE'
  | 'ELIGIBLE'
  | 'EARNED'
  | 'DEFERRED';

export type EvolutionQuality = 'BELOW_TARGET' | 'GOOD' | 'HIGH';

export interface EarnedEvolution {
  kind: 'CYCLE_EVOLUTION' | 'LEVEL_PROMOTION';
  quality: EvolutionQuality;
}

export interface MotivationalRenewal {
  kind: 'MOTIVATIONAL_RENEWAL';
  earned: false;
}

export type LevelPromotion =
  | { from: 'BEGINNER'; to: 'INTERMEDIATE' }
  | { from: 'INTERMEDIATE'; to: 'ADVANCED' };

export interface EvolutionDeferral {
  count: 0 | 1 | 2;
  deferredUntil: unknown | null;
}

export interface ProgramAdaptation {
  reason: 'AVAILABILITY' | 'GOAL' | 'ENVIRONMENT' | 'LIMITATION' | 'PREFERENCE';
}

export type WorkoutLifecycleEventType =
  | 'CYCLE_STARTED'
  | 'CYCLE_ELIGIBLE'
  | 'CYCLE_COMPLETED'
  | 'EVOLUTION_ELIGIBLE'
  | 'EVOLUTION_EARNED'
  | 'EVOLUTION_DEFERRED'
  | 'EVOLUTION_ACTIVATED'
  | 'MOTIVATIONAL_RENEWAL_OFFERED'
  | 'MOTIVATIONAL_RENEWAL_ACTIVATED'
  | 'LEVEL_PROMOTED'
  | 'PROGRAM_STARTED'
  | 'PROGRAM_ADAPTED';

export interface WorkoutLifecycleEvent<TTimestamp = unknown> {
  eventId: string;
  type: WorkoutLifecycleEventType;
  occurredAt: TTimestamp;
  cycleId: string;
  programInstanceId: string;
  idempotencyKey: string;
  payload: Record<string, string | number | boolean | null>;
  schemaVersion: typeof WORKOUT_LIFECYCLE_SCHEMA_VERSION;
}

/**
 * Fase 4 — an earned-but-not-yet-active transition (docs §11: PREPARED !=
 * ACTIVE). Single fixed-id document per user (`pendingEvolutions/current`) —
 * at most one pending evolution can exist at a time, guaranteed by
 * construction rather than by an extra invariant check.
 */
export type PendingEvolutionType = 'CYCLE_EVOLUTION' | 'LEVEL_PROMOTION' | 'MOTIVATIONAL_RENEWAL';
export type PendingEvolutionStatus = 'READY' | 'DEFERRED';

export interface PendingEvolution<TTimestamp = unknown> {
  pendingEvolutionId: string;
  type: PendingEvolutionType;
  status: PendingEvolutionStatus;
  sourceCycleId: string;
  sourceProgramInstanceId: string;
  /** Snapshot identity of the active ProgramInstance used to compute `plan`. */
  sourcePrescriptionInputSnapshotId?: string;
  fromLevel: CurrentTrainingLevel;
  toLevel: CurrentTrainingLevel;
  /** Frozen at earn time (docs §92/§93) — never recomputed from later training. */
  quality: EvolutionQuality;
  /** Frozen at earn time — real completed-session count for the cycle at the moment of earning (Fase 5 "why unlocked" copy, docs §93/§141-143). Never recomputed later. */
  sessionsCompletedAtEarn: number;
  /** Frozen at earn time — adherence ratio in basis points (0-10000) at the moment of earning. */
  adherenceAtEarnBp: number;
  /** The next prescription's content, computed once by the Fase 3 engine and stored here until activation writes it to `workoutPrograms/{targetContentIdentity}` (docs §9/§118 — content identity is precomputed, not duplicated as a second live source of truth). */
  plan: unknown;
  targetContentIdentity: string;
  targetPrescriptionIdentity: string;
  targetProgramInstanceId: string;
  targetQuestionnaireId: string;
  targetQuestionnaireVersion: number;
  /** Effective inputs frozen with the prepared prescription. Absent only on pre-8A pending documents. */
  targetPrescriptionInputSnapshot?: PrescriptionInputSnapshot;
  targetTemplateId: string;
  targetTemplateVersion: number;
  targetTemplateSourceVersion: string;
  targetTemplateContentHash: string;
  earnedAt: TTimestamp;
  deferralCount: 0 | 1 | 2;
  nextPromptAt: TTimestamp | null;
  autoActivateAt: TTimestamp | null;
  idempotencyKey: string;
  schemaVersion: typeof WORKOUT_LIFECYCLE_SCHEMA_VERSION;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}
