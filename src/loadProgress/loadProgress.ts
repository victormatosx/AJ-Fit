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
}

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
  });

  const cutoff90 = addDaysLocal(todayLocalDate, -89);
  return {
    exercises: Array.from(histories, ([exerciseId, history]) => ({ exerciseId, history })),
    recordsLast90Days: records
      .filter((record) => record.localDate >= cutoff90 && record.localDate <= todayLocalDate)
      .reverse(),
  };
}

export function loadHistoryForPeriod(
  history: readonly ExerciseLoadPoint[],
  period: LoadProgressPeriod,
  todayLocalDate: LocalDate,
): ExerciseLoadPoint[] {
  const cutoff = addDaysLocal(todayLocalDate, -(period - 1));
  return history.filter((point) => point.localDate >= cutoff && point.localDate <= todayLocalDate);
}

export function normalizeExerciseSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();
}
