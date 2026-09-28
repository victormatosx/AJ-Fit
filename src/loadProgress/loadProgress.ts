import { addDaysLocal, type LocalDate } from '../scheduleEngine/calendar';

export const LOAD_PROGRESS_PERIODS = [30, 60, 90, 365] as const;
export type LoadProgressPeriod = (typeof LOAD_PROGRESS_PERIODS)[number];

export interface LoadProgressExecution {
  executionId: string;
  scheduledLocalDate: LocalDate;
  performedLocalDate?: LocalDate;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'ABANDONED';
  exercises: {
    exerciseId: string;
    sets: {
      status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
      weightKg: number | null;
    }[];
  }[];
}

export interface ExerciseLoadPoint {
  executionId: string;
  localDate: LocalDate;
  loadKg: number;
}

export interface ExerciseLoadProgress {
  exerciseId: string;
  history: ExerciseLoadPoint[];
}

/**
 * Index-aligned by `setIndex` — `null` where that set has no valid recorded
 * weight (skipped, still pending, or the set didn't exist in that
 * execution). Only ever built from `status === 'COMPLETED'` executions (see
 * `deriveLoadProgress`) — this is the "previous workout, same set" concept,
 * distinct from `ExerciseLoadPoint` above (which also counts
 * PARTIALLY_COMPLETED/IN_PROGRESS sessions for Evolution/PR purposes).
 */
export interface ExerciseCompletedSetPoint {
  executionId: string;
  localDate: LocalDate;
  setLoadsKg: readonly (number | null)[];
}

export interface ExerciseCompletedSetHistory {
  exerciseId: string;
  history: ExerciseCompletedSetPoint[];
}

export interface LoadPersonalRecord {
  executionId: string;
  exerciseId: string;
  localDate: LocalDate;
  loadKg: number;
  previousBestKg: number;
}

export interface LoadProgressSummary {
  exercises: ExerciseLoadProgress[];
  recordsLast90Days: LoadPersonalRecord[];
  completedSetHistory: ExerciseCompletedSetHistory[];
}

export type PreviousExerciseRecords = Readonly<Record<string, number>>;
export type PreviousExerciseSetLoads = Readonly<Record<string, readonly (number | null)[]>>;
export type PreviousExerciseLastLoad = Readonly<Record<string, number>>;

function positiveCompletedLoad(weightKg: number | null, status: string): weightKg is number {
  return status === 'COMPLETED'
    && typeof weightKg === 'number'
    && Number.isFinite(weightKg)
    && weightKg > 0;
}

/**
 * Builds load history exclusively from persisted, completed sets.
 *
 * One point is the maximum completed load for an exercise in one execution.
 * A personal record is emitted only when that point strictly beats an older
 * all-time best; the first point establishes the baseline, matching the live
 * workout's existing PR rule. Abandoned workouts never contribute.
 */
export function deriveLoadProgress(
  executions: readonly LoadProgressExecution[],
  todayLocalDate: LocalDate,
): LoadProgressSummary {
  const chronological = executions
    .filter((execution) => execution.status !== 'ABANDONED')
    .map((execution, inputIndex) => ({ execution, inputIndex }))
    .sort((a, b) => (
      (a.execution.performedLocalDate ?? a.execution.scheduledLocalDate)
        .localeCompare(b.execution.performedLocalDate ?? b.execution.scheduledLocalDate)
      || a.execution.executionId.localeCompare(b.execution.executionId)
      || a.inputIndex - b.inputIndex
    ));

  const histories = new Map<string, ExerciseLoadPoint[]>();
  const completedSetHistories = new Map<string, ExerciseCompletedSetPoint[]>();
  const bestByExercise = new Map<string, number>();
  const records: LoadPersonalRecord[] = [];

  chronological.forEach(({ execution }) => {
    const performedLocalDate = execution.performedLocalDate ?? execution.scheduledLocalDate;
    const executionMaxByExercise = new Map<string, number>();
    execution.exercises.forEach((exercise) => {
      const loads = exercise.sets
        .filter((set) => positiveCompletedLoad(set.weightKg, set.status))
        .map((set) => set.weightKg as number);
      if (loads.length === 0) return;
      const max = Math.max(...loads);
      executionMaxByExercise.set(
        exercise.exerciseId,
        Math.max(max, executionMaxByExercise.get(exercise.exerciseId) ?? 0),
      );
    });

    executionMaxByExercise.forEach((loadKg, exerciseId) => {
      const history = histories.get(exerciseId) ?? [];
      history.push({
        executionId: execution.executionId,
        localDate: performedLocalDate,
        loadKg,
      });
      histories.set(exerciseId, history);

      const previousBestKg = bestByExercise.get(exerciseId);
      if (previousBestKg != null && loadKg > previousBestKg) {
        records.push({
          executionId: execution.executionId,
          exerciseId,
          localDate: performedLocalDate,
          loadKg,
          previousBestKg,
        });
      }
      bestByExercise.set(exerciseId, Math.max(loadKg, previousBestKg ?? 0));
    });

    // "Previous workout, same set" is only ever a genuinely finished session
    // — a PARTIALLY_COMPLETED/IN_PROGRESS execution still counts toward
    // history/PR above, but never qualifies as "the previous workout" here.
    if (execution.status === 'COMPLETED') {
      const executionSetLoadsByExercise = new Map<string, (number | null)[]>();
      execution.exercises.forEach((exercise) => {
        const setLoadsKg = exercise.sets.map((set) =>
          (positiveCompletedLoad(set.weightKg, set.status) ? set.weightKg as number : null));
        if (setLoadsKg.every((value) => value == null)) return;
        executionSetLoadsByExercise.set(
          exercise.exerciseId,
          mergeSetLoads(executionSetLoadsByExercise.get(exercise.exerciseId), setLoadsKg),
        );
      });
      executionSetLoadsByExercise.forEach((setLoadsKg, exerciseId) => {
        const history = completedSetHistories.get(exerciseId) ?? [];
        history.push({ executionId: execution.executionId, localDate: performedLocalDate, setLoadsKg });
        completedSetHistories.set(exerciseId, history);
      });
    }
  });

  const cutoff90 = addDaysLocal(todayLocalDate, -89);
  return {
    exercises: Array.from(histories, ([exerciseId, history]) => ({ exerciseId, history })),
    recordsLast90Days: records
      .filter((record) => record.localDate >= cutoff90 && record.localDate <= todayLocalDate)
      .reverse(),
    completedSetHistory: Array.from(completedSetHistories, ([exerciseId, history]) => ({ exerciseId, history })),
  };
}

/** Element-wise max, treating `null` as absent — mirrors `executionMaxByExercise`'s merge for the rare case where one execution lists the same exerciseId twice (e.g. a repeated finisher). */
function mergeSetLoads(
  existing: readonly (number | null)[] | undefined,
  next: readonly (number | null)[],
): (number | null)[] {
  if (!existing) return [...next];
  const length = Math.max(existing.length, next.length);
  return Array.from({ length }, (_, index) => {
    const a = existing[index] ?? null;
    const b = next[index] ?? null;
    if (a == null) return b;
    if (b == null) return a;
    return Math.max(a, b);
  });
}

export function loadHistoryForPeriod(
  history: readonly ExerciseLoadPoint[],
  period: LoadProgressPeriod,
  todayLocalDate: LocalDate,
): ExerciseLoadPoint[] {
  const cutoff = addDaysLocal(todayLocalDate, -(period - 1));
  return history.filter((point) => point.localDate >= cutoff && point.localDate <= todayLocalDate);
}

/**
 * All-time best completed load for each exercise, excluding the active
 * execution — the exercise-header "Recorde"/PR figure. Distinct from
 * `derivePreviousExerciseSetLoads` below: this is the best EVER, not the
 * most recent session.
 *
 * The load history is the same projection consumed by Evolution. Excluding
 * by execution id (rather than date/program) is what keeps a resumed workout
 * from counting its own in-progress sets as its own history while still
 * allowing the record to cross program/cycle boundaries.
 */
export function derivePreviousExerciseRecords(
  exercises: readonly ExerciseLoadProgress[],
  currentExecutionId: string | null,
): PreviousExerciseRecords {
  const records: Record<string, number> = {};

  exercises.forEach((exercise) => {
    let best = 0;
    exercise.history.forEach((point) => {
      if (point.executionId === currentExecutionId) return;
      if (!Number.isFinite(point.loadKg) || point.loadKg <= 0) return;
      if (point.loadKg > best) best = point.loadKg;
    });
    if (best > 0) records[exercise.exerciseId] = best;
  });

  return records;
}

/**
 * Per-set weight from the most recent COMPLETED execution of each exercise,
 * excluding the active one — index-aligned by `setIndex`, so set 3 today
 * compares against set 3 last time, never a single flattened "last weight
 * used". A missing exercise, or a `null` at a given index, means no valid
 * historical reference for that specific set — render `—`, never `0` or a
 * guess.
 */
export function derivePreviousExerciseSetLoads(
  completedSetHistory: readonly ExerciseCompletedSetHistory[],
  currentExecutionId: string | null,
): PreviousExerciseSetLoads {
  const previous: Record<string, readonly (number | null)[]> = {};

  completedSetHistory.forEach((exercise) => {
    for (let index = exercise.history.length - 1; index >= 0; index -= 1) {
      const point = exercise.history[index];
      if (!point || point.executionId === currentExecutionId) continue;
      previous[exercise.exerciseId] = point.setLoadsKg;
      break;
    }
  });

  return previous;
}

/**
 * Most recent valid completed load for each exercise, excluding the active
 * execution — "the last load registered", used as the fallback reference
 * when the specific set being displayed has no valid load in the last
 * COMPLETED execution (see `derivePreviousExerciseSetLoads`). Distinct from
 * `derivePreviousExerciseRecords` (the best EVER, not the most recent) and
 * from `derivePreviousExerciseSetLoads` (tied to a specific `setIndex`).
 * Never falls back to the record — a session with no valid completed load
 * at all yields no entry, not a guess.
 */
export function derivePreviousExerciseLastLoad(
  exercises: readonly ExerciseLoadProgress[],
  currentExecutionId: string | null,
): PreviousExerciseLastLoad {
  const previous: Record<string, number> = {};

  exercises.forEach((exercise) => {
    for (let index = exercise.history.length - 1; index >= 0; index -= 1) {
      const point = exercise.history[index];
      if (!point || point.executionId === currentExecutionId) continue;
      if (!Number.isFinite(point.loadKg) || point.loadKg <= 0) continue;
      previous[exercise.exerciseId] = point.loadKg;
      break;
    }
  });

  return previous;
}

export function normalizeExerciseSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();
}
