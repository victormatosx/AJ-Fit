import type { DeprecatedExperienceLevel, ExperienceLevel, LegacyExperienceLevel } from '../state/AppState';
import {
  WORKOUT_LIFECYCLE_SCHEMA_VERSION,
  type CurrentTrainingLevel,
  type PendingEvolution,
  type PendingEvolutionStatus,
  type PendingEvolutionType,
  type ProgramInstance,
  type StartingLevel,
  type TrainingCycle,
  type WorkoutLifecycle,
  type WorkoutLifecycleEvent,
  type WorkoutLifecycleEventType,
} from './types';
import { isPrescriptionInputSnapshot } from './prescriptionInputs';

const LEVELS = new Set<StartingLevel>(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
const CYCLE_STATUSES = new Set(['ACTIVE', 'COMPLETED']);
const CYCLE_ORIGINS = new Set(['V2_NATIVE', 'V1_MIGRATION_BASELINE']);
const ACTIVATION_REASONS = new Set([
  'INITIAL_PROGRAM',
  'V1_MIGRATION_BASELINE',
  'V1_AUTOMATIC_PROGRESSION',
  'MANUAL_REGENERATION',
  'AUTOMATIC_RECONCILIATION',
  'EVOLUTION_ACTIVATION',
  'PROGRAM_ADAPTATION',
]);
const PENDING_EVOLUTION_TYPES = new Set<PendingEvolutionType>(['CYCLE_EVOLUTION', 'LEVEL_PROMOTION', 'MOTIVATIONAL_RENEWAL']);
const PENDING_EVOLUTION_STATUSES = new Set<PendingEvolutionStatus>(['READY', 'DEFERRED']);
const EVOLUTION_QUALITIES = new Set(['BELOW_TARGET', 'GOOD', 'HIGH']);
const EVENT_TYPES = new Set<WorkoutLifecycleEventType>([
  'CYCLE_STARTED', 'CYCLE_ELIGIBLE', 'CYCLE_COMPLETED',
  'EVOLUTION_ELIGIBLE', 'EVOLUTION_EARNED', 'EVOLUTION_DEFERRED', 'EVOLUTION_ACTIVATED',
  'MOTIVATIONAL_RENEWAL_OFFERED', 'MOTIVATIONAL_RENEWAL_ACTIVATED',
  'LEVEL_PROMOTED', 'PROGRAM_STARTED', 'PROGRAM_ADAPTED',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function timestampLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableTimestampLike(value: unknown): boolean {
  return value == null || timestampLike(value);
}

export function startingLevelFromQuestionnaire(
  level: ExperienceLevel | DeprecatedExperienceLevel | LegacyExperienceLevel | null | undefined,
): StartingLevel | null {
  if (level === 'never_or_starting' || level === 'beginner' || level === 'beg') return 'BEGINNER';
  if (level === 'intermediate' || level === 'int') return 'INTERMEDIATE';
  if (level === 'advanced' || level === 'adv' || level === 'elite') return 'ADVANCED';
  return null;
}

/** Small deterministic hash used only for stable Firestore document ids. */
export function lifecycleStableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function cycleIdForOperation(idempotencyKey: string): string {
  return `cyc_${lifecycleStableHash(idempotencyKey)}`;
}

export function programInstanceIdForOperation(idempotencyKey: string): string {
  return `wpi_${lifecycleStableHash(idempotencyKey)}`;
}

export function lifecycleEventId(type: WorkoutLifecycleEventType, idempotencyKey: string): string {
  return `wle_${lifecycleStableHash(`${type}:${idempotencyKey}`)}`;
}

export function pendingEvolutionIdForOperation(idempotencyKey: string): string {
  return `wpe_${lifecycleStableHash(idempotencyKey)}`;
}

/**
 * Stable identity for a Fase 4 evolution operation — participates in the
 * pending evolution's own id, its target Program Instance id
 * (`activation:<key>`), and (for Cycle Evolution/Motivational Renewal) the
 * Fase 3 `targetCycleIdentity` salt. Two `prepare` calls for the SAME source
 * Program Instance and decision type always converge on the same key; a
 * genuinely new source state (a later Program Instance) gets a new one
 * (docs §15/§16).
 */
export function evolutionIdempotencyKey(input: {
  sourceProgramInstanceId: string;
  type: PendingEvolutionType;
}): string {
  return `evolution:${input.sourceProgramInstanceId}:${input.type}`;
}

export function isWorkoutLifecycle(value: unknown): value is WorkoutLifecycle {
  if (!isRecord(value)) return false;
  return value.schemaVersion === WORKOUT_LIFECYCLE_SCHEMA_VERSION
    && LEVELS.has(value.startingLevel as StartingLevel)
    && LEVELS.has(value.currentTrainingLevel as CurrentTrainingLevel)
    && nonEmptyString(value.currentCycleId)
    && Number.isInteger(value.currentCycleNumber)
    && Number(value.currentCycleNumber) >= 1
    && nonEmptyString(value.activeProgramInstanceId)
    && nonEmptyString(value.activeContentIdentity)
    && nonEmptyString(value.activePrescriptionIdentity)
    && CYCLE_ORIGINS.has(String(value.initializationOrigin))
    && timestampLike(value.historyCompleteFrom)
    && timestampLike(value.createdAt)
    && timestampLike(value.updatedAt);
}

export function isTrainingCycle(value: unknown): value is TrainingCycle {
  if (!isRecord(value)) return false;
  return value.schemaVersion === WORKOUT_LIFECYCLE_SCHEMA_VERSION
    && nonEmptyString(value.cycleId)
    && LEVELS.has(value.level as CurrentTrainingLevel)
    && Number.isInteger(value.cycleNumber)
    && Number(value.cycleNumber) >= 1
    && CYCLE_STATUSES.has(String(value.status))
    && CYCLE_ORIGINS.has(String(value.origin))
    && nonEmptyString(value.programInstanceId)
    && (value.previousProgramInstanceId === null || nonEmptyString(value.previousProgramInstanceId))
    && timestampLike(value.startedAt)
    && nullableTimestampLike(value.eligibleAt)
    && nullableTimestampLike(value.completedAt)
    && (value.completionReason === undefined || value.completionReason === null || value.completionReason === 'EARNED_EVOLUTION')
    && nonEmptyString(value.progressionReason)
    && timestampLike(value.createdAt)
    && timestampLike(value.updatedAt);
}

export function isProgramInstance(value: unknown): value is ProgramInstance {
  if (!isRecord(value)) return false;
  return value.schemaVersion === WORKOUT_LIFECYCLE_SCHEMA_VERSION
    && nonEmptyString(value.programInstanceId)
    && nonEmptyString(value.cycleId)
    && nonEmptyString(value.contentIdentity)
    && nonEmptyString(value.prescriptionIdentity)
    && nonEmptyString(value.questionnaireId)
    && (value.prescriptionInputSnapshot === undefined || isPrescriptionInputSnapshot(value.prescriptionInputSnapshot))
    && timestampLike(value.activatedAt)
    && nullableTimestampLike(value.supersededAt)
    && (value.previousProgramInstanceId === null || nonEmptyString(value.previousProgramInstanceId))
    && ACTIVATION_REASONS.has(String(value.activationReason))
    && timestampLike(value.createdAt)
    && timestampLike(value.updatedAt);
}

export function isWorkoutLifecycleEvent(value: unknown): value is WorkoutLifecycleEvent {
  if (!isRecord(value)) return false;
  return value.schemaVersion === WORKOUT_LIFECYCLE_SCHEMA_VERSION
    && nonEmptyString(value.eventId)
    && EVENT_TYPES.has(value.type as WorkoutLifecycleEventType)
    && timestampLike(value.occurredAt)
    && nonEmptyString(value.cycleId)
    && nonEmptyString(value.programInstanceId)
    && nonEmptyString(value.idempotencyKey)
    && isRecord(value.payload);
}

export function isPendingEvolution(value: unknown): value is PendingEvolution {
  if (!isRecord(value)) return false;
  return value.schemaVersion === WORKOUT_LIFECYCLE_SCHEMA_VERSION
    && nonEmptyString(value.pendingEvolutionId)
    && PENDING_EVOLUTION_TYPES.has(value.type as PendingEvolutionType)
    && PENDING_EVOLUTION_STATUSES.has(value.status as PendingEvolutionStatus)
    && nonEmptyString(value.sourceCycleId)
    && nonEmptyString(value.sourceProgramInstanceId)
    && (value.sourcePrescriptionInputSnapshotId === undefined || nonEmptyString(value.sourcePrescriptionInputSnapshotId))
    && LEVELS.has(value.fromLevel as StartingLevel)
    && LEVELS.has(value.toLevel as StartingLevel)
    && EVOLUTION_QUALITIES.has(String(value.quality))
    && Number.isInteger(value.sessionsCompletedAtEarn) && Number(value.sessionsCompletedAtEarn) >= 0
    && Number.isInteger(value.adherenceAtEarnBp) && Number(value.adherenceAtEarnBp) >= 0 && Number(value.adherenceAtEarnBp) <= 10000
    && isRecord(value.plan)
    && nonEmptyString(value.targetContentIdentity)
    && nonEmptyString(value.targetPrescriptionIdentity)
    && nonEmptyString(value.targetProgramInstanceId)
    && nonEmptyString(value.targetQuestionnaireId)
    && Number.isInteger(value.targetQuestionnaireVersion)
    && (value.targetPrescriptionInputSnapshot === undefined || isPrescriptionInputSnapshot(value.targetPrescriptionInputSnapshot))
    && nonEmptyString(value.targetTemplateId)
    && Number.isInteger(value.targetTemplateVersion)
    && nonEmptyString(value.targetTemplateSourceVersion)
    && nonEmptyString(value.targetTemplateContentHash)
    && timestampLike(value.earnedAt)
    && [0, 1, 2].includes(value.deferralCount as number)
    && nullableTimestampLike(value.nextPromptAt)
    && nullableTimestampLike(value.autoActivateAt)
    && nonEmptyString(value.idempotencyKey)
    && timestampLike(value.createdAt)
    && timestampLike(value.updatedAt);
}
