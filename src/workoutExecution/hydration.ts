import type { PersistedWorkoutExecution } from '../services/workoutExecutions';
import type { CardioExecutionRecord } from './types';

/**
 * Workout Recovery / Resume após process death — WorkoutScreen's own local
 * progress state, reverse-derived from a persisted execution so a resumed
 * session opens exactly where it left off. The Firestore WorkoutExecution
 * remains the only source of truth for progress; this is a pure, one-way
 * projection of it into the shape WorkoutScreen's local `useState`s already
 * expect — never the other way around.
 */
export interface WorkoutHydrationSnapshot {
  /**
   * Queue of exercise indices with at least one non-PENDING-cleared set
   * remaining, in ascending original order — mirrors WorkoutScreen's own
   * `order` invariant (it only ever shrinks via `.slice(1)` as an exercise
   * finishes, never reorders here). A skip-and-requeue's exact queue
   * position is ephemeral UI state, never persisted, so it isn't
   * reconstructed — the affected exercise simply resumes in its original
   * slot, which is always still correct (docs §7 "derive deterministically
   * from the first pending set").
   */
  order: number[];
  /** exerciseIndex -> count of leading sets already COMPLETED/SKIPPED, i.e. the index of the next set to perform — same semantics as WorkoutScreen's own `progress`. */
  progress: Record<number, number>;
  /** `${exerciseId}-${setIndex}` -> weightKg, for every COMPLETED set — the exact key shape WorkoutScreen's `logged`/`lastWeight()` already use, so already-registered loads render and pre-fill with no other change. */
  logged: Record<string, number>;
  /** True once no exercise has a PENDING set left — the resumed screen should open directly on the cardio finisher / completion screen rather than replaying an already-finished exercise list. */
  allDone: boolean;
  /**
   * Cardio Finisher Completion Recovery hardening (2026-09): true iff the
   * persisted execution's `cardio` record is `{ status: 'COMPLETED' }` —
   * never derived from local timer/AsyncStorage state. `WorkoutScreen` uses
   * this (together with `allDone`) to distinguish "cardio not done yet,
   * resume the timer" from "cardio already done, only the terminal
   * `finish()` chain is still pending" — the latter must never re-show a
   * blank/ready cardio screen. Always `false` for an execution whose session
   * has no cardio finisher at all (nothing ever writes this record), which
   * is harmless: `WorkoutScreen` only ever consults this when the plan says
   * the session HAS one.
   */
  cardioCompleted: boolean;
}

/**
 * `exerciseIds[i]` must be the same materialized id WorkoutScreen uses for
 * exercise slot `i` (`workoutExercisesFromPlan(...)[i].id`) — positionally
 * aligned with `execution.exercises[].exerciseIndex` by construction
 * (`buildInitialExerciseExecutions` builds both from the same
 * `session.exercises` array). A freshly-started (all-PENDING) execution
 * derives to WorkoutScreen's own pre-existing defaults (`order=[0..n-1]`,
 * empty `progress`/`logged`, `allDone=false`), so callers can derive from
 * `execution` unconditionally — no separate "fresh vs resumed" branch is
 * needed anywhere else.
 */
export function deriveWorkoutHydration(
  execution: Pick<PersistedWorkoutExecution, 'exercises'> & { cardio?: CardioExecutionRecord | null },
  exerciseIds: readonly string[],
): WorkoutHydrationSnapshot {
  const progress: Record<number, number> = {};
  const logged: Record<string, number> = {};
  const order: number[] = [];

  const byIndex = new Map(execution.exercises.map((exercise) => [exercise.exerciseIndex, exercise]));
  for (let exIdx = 0; exIdx < exerciseIds.length; exIdx += 1) {
    const exerciseExecution = byIndex.get(exIdx);
    // Defensive: a materialized slot the execution never recorded a row for
    // (shouldn't happen given positional construction) — treat as untouched.
    if (!exerciseExecution) {
      progress[exIdx] = 0;
      order.push(exIdx);
      continue;
    }

    const sets = exerciseExecution.sets;
    const firstPendingIndex = sets.findIndex((set) => set.status === 'PENDING');
    const doneCount = firstPendingIndex === -1 ? sets.length : firstPendingIndex;
    progress[exIdx] = doneCount;
    if (doneCount < sets.length) order.push(exIdx);

    const exerciseId = exerciseIds[exIdx];
    sets.forEach((set, setIdx) => {
      if (set.status === 'COMPLETED' && set.weightKg !== null) {
        logged[`${exerciseId}-${setIdx}`] = set.weightKg;
      }
    });
  }

  return {
    order,
    progress,
    logged,
    allDone: order.length === 0,
    cardioCompleted: execution.cardio?.status === 'COMPLETED',
  };
}
