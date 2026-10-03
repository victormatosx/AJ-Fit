import type { LoadPersonalRecord } from '../loadProgress/loadProgress';
import type { SessionMuscleBreakdown } from '../lib/sessionMuscles';
import type { PersistedWorkoutExecution } from '../services/workoutExecutions';
import { performedLocalDateOf } from '../workoutExecution/types';
import type { WorkoutCompletion } from '../workoutExecution/types';
import { buildWorkoutShareBodyMap, countCompletedExecutionSets } from '../workoutShare/data';
import { selectWorkoutHighlights, type WorkoutHighlight } from './highlights';
import { computeExerciseMaxLoadKg, computeSessionVolumeKg, computeTotalCompletedReps, performedExerciseIds } from './metrics';
import { buildWorkoutPulse, type WorkoutPulse } from './pulse';

export interface WorkoutSummaryPersonalRecord {
  exerciseId: string;
  newLoadKg: number;
  previousBestKg: number;
}

export interface WorkoutSummaryCurrentBest {
  exerciseId: string;
  loadKg: number;
}

export interface WorkoutSummaryData {
  workoutName: string;
  performedLocalDate: string;
  durationSeconds: number;
  completedSetCount: number;
  completion: WorkoutCompletion | null;
  finalizedEarly: boolean;
  cardioSkipped: boolean;
  volumeKg: number;
  totalReps: number;
  personalRecordCount: number;
  /** New records set in this exact session — empty is a legitimate, expected result. */
  personalRecords: WorkoutSummaryPersonalRecord[];
  /** Best current loads for exercises performed today, for the neutral fallback state when `personalRecords` is empty. */
  currentBests: WorkoutSummaryCurrentBest[];
  /** False when every performed exercise was bodyweight/duration-only — the Records section degrades to a "no load data" state instead of showing an empty list. */
  hasLoadBasedData: boolean;
  pulse: WorkoutPulse;
  highlights: WorkoutHighlight[];
  bodyMap: SessionMuscleBreakdown;
}

const MAX_CURRENT_BESTS = 3;

/**
 * Uses the server-frozen terminal facts when present. Legacy sessions only
 * receive a percentage when their immutable set snapshot is complete enough
 * to count deterministically; malformed/empty history is left unlabelled.
 */
export function resolveWorkoutCompletion(
  execution: PersistedWorkoutExecution,
): WorkoutCompletion | null {
  const persisted = execution.completion;
  if (persisted
    && Number.isInteger(persisted.plannedSets)
    && Number.isInteger(persisted.completedSets)
    && Number.isInteger(persisted.percentageBasisPoints)
    && persisted.plannedSets > 0
    && persisted.completedSets >= 0
    && persisted.completedSets <= persisted.plannedSets
    && persisted.percentageBasisPoints === Math.round(
      (persisted.completedSets / persisted.plannedSets) * 10_000,
    )) {
    return persisted;
  }
  if (!['COMPLETED', 'PARTIALLY_COMPLETED'].includes(execution.status)
    || execution.exercises.length === 0
    || execution.exercises.some((exercise) => exercise.sets.length === 0)) {
    return null;
  }
  const sets = execution.exercises.flatMap((exercise) => exercise.sets);
  if (sets.some((set) => !['PENDING', 'COMPLETED', 'SKIPPED'].includes(set.status))) return null;
  const completedSets = sets.filter((set) => set.status === 'COMPLETED').length;
  return {
    plannedSets: sets.length,
    completedSets,
    percentageBasisPoints: Math.round((completedSets / sets.length) * 10_000),
  };
}

/**
 * Single orchestration point for the post-workout summary screen's data —
 * every number here is either read straight from the persisted execution or
 * derived by a pure function already covered by its own tests
 * (`metrics.ts`, `pulse.ts`, `highlights.ts`). No Firestore access: callers
 * pass in whatever `LoadProgressContext` and `findPreviousEquivalentExecution`
 * already resolved.
 */
export function buildWorkoutSummaryData(input: {
  workoutName: string;
  execution: PersistedWorkoutExecution;
  durationSeconds: number;
  recordsLast90Days: readonly LoadPersonalRecord[];
  previousEquivalentExecution: PersistedWorkoutExecution | null;
}): WorkoutSummaryData {
  const { workoutName, execution, durationSeconds, recordsLast90Days, previousEquivalentExecution } = input;

  const personalRecords: WorkoutSummaryPersonalRecord[] = recordsLast90Days
    .filter((record) => record.executionId === execution.executionId)
    .map((record) => ({ exerciseId: record.exerciseId, newLoadKg: record.loadKg, previousBestKg: record.previousBestKg }));
  const recordedExerciseIds = new Set(personalRecords.map((record) => record.exerciseId));

  const exerciseLoads = performedExerciseIds(execution)
    .map((exerciseId) => ({ exerciseId, loadKg: computeExerciseMaxLoadKg(execution, exerciseId) }));
  const hasLoadBasedData = exerciseLoads.some((item) => item.loadKg != null) || personalRecords.length > 0;

  const currentBests: WorkoutSummaryCurrentBest[] = exerciseLoads
    .filter((item) => !recordedExerciseIds.has(item.exerciseId))
    .filter((item): item is WorkoutSummaryCurrentBest => item.loadKg != null)
    .sort((a, b) => b.loadKg - a.loadKg)
    .slice(0, MAX_CURRENT_BESTS);

  return {
    workoutName,
    performedLocalDate: performedLocalDateOf(execution),
    durationSeconds: Math.max(0, Math.floor(durationSeconds)),
    completedSetCount: countCompletedExecutionSets(execution),
    completion: resolveWorkoutCompletion(execution),
    // A plain NORMAL finish can also land on PARTIALLY_COMPLETED (skipped
    // sets along the way) — only an explicit `finalizationMode === 'EARLY'`
    // means the user actually chose "Finalizar antes". Absent on executions
    // finalized before this field existed; absence is never read as EARLY.
    finalizedEarly: execution.finalizationMode === 'EARLY',
    cardioSkipped: execution.cardio?.status === 'SKIPPED',
    volumeKg: computeSessionVolumeKg(execution),
    totalReps: computeTotalCompletedReps(execution),
    personalRecordCount: personalRecords.length,
    personalRecords,
    currentBests,
    hasLoadBasedData,
    pulse: buildWorkoutPulse(execution, previousEquivalentExecution),
    highlights: selectWorkoutHighlights({ execution, recordsLast90Days, previousEquivalentExecution }),
    bodyMap: buildWorkoutShareBodyMap(execution),
  };
}
