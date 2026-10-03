import type { PersistedWorkoutExecution } from '../../services/workoutExecutions';
import type { ExerciseExecution, SetExecution } from '../../workoutExecution/types';
import type { CardioExecutionRecord, WorkoutCompletion } from '../../workoutExecution/types';

export function completedSet(weightKg: number | null, actualReps: number | null): SetExecution {
  return { setIndex: 0, status: 'COMPLETED', actualReps, weightKg, actualDurationSeconds: null };
}

export function skippedSet(): SetExecution {
  return { setIndex: 0, status: 'SKIPPED', actualReps: null, weightKg: null, actualDurationSeconds: null };
}

export function exercise(exerciseId: string, exerciseIndex: number, sets: SetExecution[]): ExerciseExecution {
  return {
    exerciseIndex,
    exerciseId,
    prescribedSets: sets.length,
    prescribedReps: null,
    prescribedDuration: null,
    prescribedCycles: null,
    sets: sets.map((set, setIndex) => ({ ...set, setIndex })),
  };
}

/**
 * Minimal `Timestamp`-shaped stub (only `.toMillis()` — the only method any
 * production code in this module's scope calls on `startedAt`/`finishedAt`).
 * Defaults every fixture to a real, orderable instant derived from
 * `scheduledLocalDate` so ordering logic (`findPreviousEquivalentExecution`)
 * behaves exactly as it would against real Firestore `Timestamp`s, without
 * every existing test needing to supply one explicitly.
 */
function stubTimestamp(epochMs: number): PersistedWorkoutExecution['startedAt'] {
  return { toMillis: () => epochMs } as unknown as PersistedWorkoutExecution['startedAt'];
}

export function buildExecution(input: {
  executionId: string;
  programId?: string;
  programInstanceId?: string;
  sessionIndex?: number;
  occurrence?: number;
  scheduledLocalDate: string;
  performedLocalDate?: string;
  status?: 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'ABANDONED';
  exercises: ExerciseExecution[];
  completion?: WorkoutCompletion;
  cardio?: CardioExecutionRecord | null;
  finalizationMode?: 'NORMAL' | 'EARLY';
  /** Overrides the default (derived from `scheduledLocalDate`) instant — use to simulate multiple same-day executions at distinct real moments. */
  startedAtMs?: number;
  finishedAtMs?: number | null;
}): PersistedWorkoutExecution {
  const defaultMs = Date.parse(`${input.scheduledLocalDate}T00:00:00Z`);
  return {
    executionId: input.executionId,
    programId: input.programId ?? 'program-1',
    programInstanceId: input.programInstanceId,
    templateId: 'template-1',
    sessionIndex: input.sessionIndex ?? 0,
    ...(input.occurrence !== undefined ? { occurrence: input.occurrence } : {}),
    sessionName: 'Push',
    scheduledLocalDate: input.scheduledLocalDate,
    performedLocalDate: input.performedLocalDate,
    status: input.status ?? 'COMPLETED',
    startedAt: stubTimestamp(input.startedAtMs ?? defaultMs),
    finishedAt: input.finishedAtMs === null ? null : stubTimestamp(input.finishedAtMs ?? input.startedAtMs ?? defaultMs),
    exercises: input.exercises,
    cardio: input.cardio ?? null,
    ...(input.completion ? { completion: input.completion } : {}),
    ...(input.finalizationMode ? { finalizationMode: input.finalizationMode } : {}),
    executionSchemaVersion: 1,
    createdAt: {} as never,
    updatedAt: {} as never,
    timestampAuthority: 'SERVER',
  } as unknown as PersistedWorkoutExecution;
}
