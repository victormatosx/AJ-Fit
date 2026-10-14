import { addDaysLocal, type LocalDate } from '../../scheduleEngine/calendar';
import type { ExerciseLoadProgress, LoadPersonalRecord } from '../../loadProgress/loadProgress';

/**
 * Demonstrative data only — never persisted, never sent to any backend.
 * Used exclusively by `LoadsEvolutionView` to feed the blurred preview shown
 * when the real account has no load history yet (see `EvolutionLockedPreview`).
 *
 * All three exercise ids are real catalog entries (`exercisesSeedData.ts`),
 * so `exerciseDisplayName` resolves a real translated name instead of
 * falling back to the raw id. Dates are relative to `todayLocalDate` so the
 * preview always looks current, no matter when it's viewed.
 */

interface DemoExerciseSpec {
  exerciseId: string;
  loadsKgOldestToNewest: readonly number[];
}

const DEMO_EXERCISES: readonly DemoExerciseSpec[] = [
  { exerciseId: 'barbell-back-squat', loadsKgOldestToNewest: [60, 65, 70, 75] },
  { exerciseId: 'conventional-deadlift', loadsKgOldestToNewest: [80, 85, 92, 100] },
  { exerciseId: 'machine-flat-bench-press', loadsKgOldestToNewest: [40, 42, 45, 48] },
];

export function buildDemoLoadExercises(todayLocalDate: LocalDate): ExerciseLoadProgress[] {
  return DEMO_EXERCISES.map(({ exerciseId, loadsKgOldestToNewest }) => ({
    exerciseId,
    history: loadsKgOldestToNewest.map((loadKg, index) => {
      const daysAgo = (loadsKgOldestToNewest.length - 1 - index) * 7;
      return {
        executionId: `demo-execution-${exerciseId}-${index}`,
        localDate: addDaysLocal(todayLocalDate, -daysAgo),
        loadKg,
      };
    }),
  }));
}

export function buildDemoLoadRecords(todayLocalDate: LocalDate): LoadPersonalRecord[] {
  return DEMO_EXERCISES.map(({ exerciseId, loadsKgOldestToNewest }) => {
    const latest = loadsKgOldestToNewest[loadsKgOldestToNewest.length - 1]!;
    const previous = loadsKgOldestToNewest[loadsKgOldestToNewest.length - 2]!;
    return {
      executionId: `demo-execution-${exerciseId}-${loadsKgOldestToNewest.length - 1}`,
      exerciseId,
      localDate: todayLocalDate,
      loadKg: latest,
      previousBestKg: previous,
    };
  });
}
