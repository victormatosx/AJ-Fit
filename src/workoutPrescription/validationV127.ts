import { EXERCISES_SEED } from '../data/exercisesSeedData';
import { CANONICAL_ACTIVITIES } from './canonicalActivities';
import type { FinalWorkoutSession, TemplateId } from './types';

/**
 * Fase 9 §1 — v1.27's own structural validator. Deliberately NOT
 * `validation.ts`'s `validateFinalWorkout` (that function's
 * `exerciseExists` only ever indexes `EXERCISES_SEED`, never
 * `CANONICAL_ACTIVITIES`, and its `modifiers`/`SelectionDecision` shape is
 * legacy-`ResolvedModifier`-specific — v1.27 has no such concept). This is a
 * parallel, self-contained check, not a v2 behavior change.
 */
const activeResistanceIds = new Set(
  EXERCISES_SEED
    .filter((exercise) => exercise.status === 'active' && exercise.availability.workoutGeneration)
    .map((exercise) => exercise.id),
);
const activityIds = new Set(CANONICAL_ACTIVITIES.map((activity) => activity.id));

export function exerciseExistsV127(exerciseId: string): boolean {
  return activeResistanceIds.has(exerciseId) || activityIds.has(exerciseId);
}

/**
 * No `TRAINING_SESSION_ORDER_INVALID`-equivalent check here on purpose: 8
 * of the T091-T102 beginner templates deliberately interleave
 * `active_recovery` sessions between training sessions (e.g. T093:
 * resistance, active_recovery, resistance, resistance) — a legitimate
 * authored beginner cadence, not a composition defect. v2's strict
 * "training sessions must occupy indexes [0..n) contiguously" invariant
 * does not hold for v1.27 and is not reproduced here. See the Fase 9 QA
 * report §H/§blockers for the follow-up this implies for schedule/UI code
 * that might assume contiguous training indexes.
 */
export function validateFinalWorkoutV127(input: {
  templateId: TemplateId;
  sessions: FinalWorkoutSession[];
}): string[] {
  const errors: string[] = [];
  if (!/^T(?:00[1-9]|0[1-9][0-9]|10[0-2])$/.test(input.templateId)) {
    errors.push('TEMPLATE_ID_OUTSIDE_CANONICAL_RANGE');
  }
  if (!input.sessions.length) errors.push('NO_SESSIONS');
  for (const [sessionIndex, session] of input.sessions.entries()) {
    if (!session.exercises.length) errors.push(`EMPTY_SESSION:${sessionIndex}`);
    const sourceByFinalId = new Map<string, string>();
    for (const exercise of session.exercises) {
      if (!exerciseExistsV127(exercise.exerciseId)) errors.push(`MISSING_EXERCISE:${exercise.exerciseId}`);
      const previousSource = sourceByFinalId.get(exercise.exerciseId);
      if (previousSource && previousSource !== exercise.sourceExerciseId) {
        errors.push(`SUBSTITUTION_COLLISION:${sessionIndex}:${exercise.exerciseId}`);
      }
      sourceByFinalId.set(exercise.exerciseId, exercise.sourceExerciseId);
      if (exercise.sets == null && exercise.duration == null && exercise.distance == null && exercise.cycleRange == null) {
        errors.push(`INVALID_EXERCISE_DOSE:${sessionIndex}:${exercise.exerciseId}`);
      }
      if (exercise.sets !== undefined
        && (typeof exercise.sets !== 'number' || !Number.isInteger(exercise.sets)
          || exercise.sets < 1 || exercise.sets > 10)) {
        errors.push(`INVALID_EXERCISE_SETS:${sessionIndex}:${exercise.exerciseId}`);
      }
      if (exercise.cycles !== undefined
        && (typeof exercise.cycles !== 'number' || !Number.isInteger(exercise.cycles)
          || exercise.cycles < 1 || exercise.cycles > 100)) {
        errors.push(`INVALID_EXERCISE_CYCLES:${sessionIndex}:${exercise.exerciseId}`);
      }
      if (exercise.cycleRange !== undefined
        && (!Number.isInteger(exercise.cycleRange.min)
          || !Number.isInteger(exercise.cycleRange.max)
          || exercise.cycleRange.min < 1
          || exercise.cycleRange.max < exercise.cycleRange.min
          || exercise.cycleRange.max > 100)) {
        errors.push(`INVALID_EXERCISE_CYCLE_RANGE:${sessionIndex}:${exercise.exerciseId}`);
      }
    }
  }
  return [...new Set(errors)].sort();
}
