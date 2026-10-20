import type { LocalDate } from '../scheduleEngine/calendar';
import { getExerciseTarget } from '../lib/muscleCatalog';
import type { MuscleId } from '../types/exercise';
import {
  loadHistoryForPeriod,
  type ExerciseLoadProgress,
  type LoadProgressPeriod,
} from './loadProgress';

/**
 * Per-muscle-group load gain, projected from the load history the Evolution
 * screen already owns.
 *
 * Deliberately NOT a new domain metric: nothing here reads Firestore, and no
 * value is invented. Each number is a plain arithmetic projection of
 * `ExerciseLoadProgress.history` — the same points the per-exercise chart
 * draws — grouped by the bundled catalog's `primaryMuscle`
 * (`getExerciseTarget`, the exact resolver `BodyMuscleMap`'s session
 * projection already uses).
 *
 * The rules, stated once so the UI never has to re-state them:
 *
 *  - An exercise contributes a gain only with at least TWO points inside the
 *    window. One point has nothing to compare against, so it is counted as
 *    "no measurable gain" and skipped — never as 0%.
 *  - An exercise's gain is `(last - first) / first`, oldest-to-newest inside
 *    the window. It can be negative; the caller decides how to colour that.
 *  - A group's gain is the unweighted mean of its contributing exercises'
 *    gains. Mean rather than max so a single lucky session cannot speak for
 *    a whole muscle, and unweighted because the history carries no reps or
 *    volume to weight by (see `ExerciseLoadPoint`).
 *  - A group with no contributing exercise is omitted entirely. There is no
 *    "+0%" row for a muscle the user simply hasn't trained twice yet.
 *  - `bestExerciseId`/`bestLoadKg` is the heaviest single point in the
 *    window across the group's contributing exercises — a real recorded
 *    load, not an average.
 *
 * Exercises missing from the bundled catalog are skipped: without a target
 * there is no honest group to file them under.
 */

export interface MuscleGroupLoadGain {
  muscle: MuscleId;
  /** Mean relative change across the group's exercises. `0.12` is +12%. */
  gainRatio: number;
  /** How many exercises actually backed `gainRatio` (always >= 1). */
  exerciseCount: number;
  /** Heaviest single recorded point in the window, within this group. */
  bestExerciseId: string;
  bestLoadKg: number;
}

interface GroupAccumulator {
  gains: number[];
  bestExerciseId: string;
  bestLoadKg: number;
}

export function deriveMuscleGroupLoadGains(
  exercises: readonly ExerciseLoadProgress[],
  period: LoadProgressPeriod,
  todayLocalDate: LocalDate,
): MuscleGroupLoadGain[] {
  const byMuscle = new Map<MuscleId, GroupAccumulator>();

  exercises.forEach((exercise) => {
    const muscle = getExerciseTarget(exercise.exerciseId)?.primaryMuscle;
    if (!muscle) return;

    const window = loadHistoryForPeriod(exercise.history, period, todayLocalDate);
    if (window.length < 2) return;

    const first = window[0]!.loadKg;
    const last = window[window.length - 1]!.loadKg;
    if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return;

    const heaviest = window.reduce(
      (best, point) => (point.loadKg > best ? point.loadKg : best),
      0,
    );

    const current = byMuscle.get(muscle);
    if (!current) {
      byMuscle.set(muscle, {
        gains: [(last - first) / first],
        bestExerciseId: exercise.exerciseId,
        bestLoadKg: heaviest,
      });
      return;
    }

    current.gains.push((last - first) / first);
    if (heaviest > current.bestLoadKg) {
      current.bestLoadKg = heaviest;
      current.bestExerciseId = exercise.exerciseId;
    }
  });

  return Array.from(byMuscle, ([muscle, group]) => ({
    muscle,
    gainRatio: group.gains.reduce((total, gain) => total + gain, 0) / group.gains.length,
    exerciseCount: group.gains.length,
    bestExerciseId: group.bestExerciseId,
    bestLoadKg: group.bestLoadKg,
  })).sort((a, b) => b.gainRatio - a.gainRatio || a.muscle.localeCompare(b.muscle));
}
