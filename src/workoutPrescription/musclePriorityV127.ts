import {
  primaryMuscleForRuntimeIdV127,
  primaryMuscleMatchesAnyTargetV127,
  type MusclePriorityTargetV127,
} from './canonicalMusclePriorityV127';
import type { FinalWorkoutExercise, FinalWorkoutSession } from './types';

/**
 * Fase 6 — the second (and, per this migration's plan, last) canonical
 * v1.27 modifier: `muscle_priority`. Pure, deterministic, no I/O. Runs
 * strictly after the musculoskeletal-limitation stage
 * (`musculoskeletalLimitationV127.ts`) in `compositionV127.ts` — it only
 * ever reads `exercise.exerciseId`, the FINAL id after any substitution,
 * never `sourceExerciseId` (Fase 6 §2/§10).
 *
 * Deliberately NOT the legacy v2 muscle-priority path
 * (`composition.ts`'s `priorityCandidates`/`selectSlotIndices`/the
 * `MUSCLE_PRIORITY_SET_ADDED`/`_REORDERED`/`_PRESERVED` decisions, or
 * `personalization.ts`/duration-driven slot protection) — that stays
 * exactly as-is, driving only the active v2 runtime. This module changes
 * order only: never a set count, never a rep/duration/distance/cycle/
 * intensity value, never which exercises exist, never rest, never which
 * session a slot belongs to.
 */

export interface MusclePriorityDecisionV127 {
  sessionIndex: number;
  /** True only when this session's resistance-exercise order actually changed. */
  reordered: boolean;
  prioritizedExerciseIds: string[];
}

export interface MusclePriorityResultV127 {
  sessions: FinalWorkoutSession[];
  decisions: MusclePriorityDecisionV127[];
}

/**
 * Stable partition of the resistance-exercise SUBSEQUENCE within a
 * session's exercise list. Non-resistance slots (cardio/mobility
 * `CANONICAL_ACTIVITIES` ids — anything with no `EXERCISES_SEED`
 * `primaryMuscle`, per `primaryMuscleForRuntimeIdV127`) never move, at any
 * position — this is a strict superset of "preserve leading warmup/
 * mobility blocks" (Fase 6 §6): ANY non-resistance slot, anywhere in the
 * list, keeps its exact original position. Among the resistance slots
 * only, exercises matching an active target move before the rest,
 * preserving each group's original relative order (stable, not `.sort()`).
 */
function reorderSessionExercises(
  exercises: readonly FinalWorkoutExercise[],
  targets: readonly MusclePriorityTargetV127[],
): { exercises: FinalWorkoutExercise[]; reordered: boolean; prioritizedExerciseIds: string[] } {
  const resistanceIndices: number[] = [];
  for (let index = 0; index < exercises.length; index += 1) {
    if (primaryMuscleForRuntimeIdV127(exercises[index].exerciseId) != null) resistanceIndices.push(index);
  }
  if (!resistanceIndices.length) {
    return { exercises: exercises as FinalWorkoutExercise[], reordered: false, prioritizedExerciseIds: [] };
  }

  const resistanceSlots = resistanceIndices.map((index) => exercises[index]);
  const prioritized: FinalWorkoutExercise[] = [];
  const nonPrioritized: FinalWorkoutExercise[] = [];
  for (const slot of resistanceSlots) {
    const primaryMuscle = primaryMuscleForRuntimeIdV127(slot.exerciseId);
    // primaryMuscle is non-null here — slot came from resistanceIndices.
    if (primaryMuscle != null && primaryMuscleMatchesAnyTargetV127(primaryMuscle, targets)) prioritized.push(slot);
    else nonPrioritized.push(slot);
  }
  const newResistanceOrder = [...prioritized, ...nonPrioritized];

  const reordered = newResistanceOrder.some((slot, index) => slot !== resistanceSlots[index]);
  if (!reordered) {
    return { exercises: exercises as FinalWorkoutExercise[], reordered: false, prioritizedExerciseIds: prioritized.map((slot) => slot.exerciseId) };
  }

  const result = exercises.slice();
  resistanceIndices.forEach((originalIndex, k) => { result[originalIndex] = newResistanceOrder[k]; });
  return { exercises: result, reordered: true, prioritizedExerciseIds: prioritized.map((slot) => slot.exerciseId) };
}

/**
 * `targets` is already-normalized (`normalizeMusclePriorityInputV127`), and
 * already treated as ONE merged bucket — Fase 6 §7 requires auditing
 * whether the questionnaire's `muscleFocus: string[]` carries explicit
 * rank semantics before implementing a ranked (priority-1-then-2) order.
 * It does not: `MultiList` (`components/onboarding/QuestionRenderer.tsx`)
 * is a plain toggle grid — selecting/deselecting reorders nothing visually,
 * shows no "1st"/"2nd" badge, and `exclusiveNone`
 * (`lib/questionnaireSchema.ts`) only deduplicates, it does not assign
 * rank. Treating the up-to-2 selections as a single combined "prioritized"
 * set (Fase 6 §7's documented fallback) is therefore the only
 * non-fabricated reading of what is actually stored.
 */
export function applyMusclePriorityV127(
  sessions: readonly FinalWorkoutSession[],
  targets: readonly MusclePriorityTargetV127[],
): MusclePriorityResultV127 {
  if (!targets.length) {
    return { sessions: sessions as FinalWorkoutSession[], decisions: [] };
  }
  const decisions: MusclePriorityDecisionV127[] = [];
  const resultSessions = sessions.map((session, sessionIndex) => {
    const { exercises, reordered, prioritizedExerciseIds } = reorderSessionExercises(session.exercises, targets);
    decisions.push({ sessionIndex, reordered, prioritizedExerciseIds });
    if (!reordered) return session;
    return { ...session, exercises };
  });
  return { sessions: resultSessions, decisions };
}
