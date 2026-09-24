import type { FinalWorkoutSession, ResolvedModifier, SelectionDecision } from './types';
import { exerciseExists } from './composition';
import { activeRecoverySessionIndexes, trainingSessionIndexes } from './weeklySchedule';

export function validateFinalWorkout(input: {
  selection: SelectionDecision;
  sessions: FinalWorkoutSession[];
  modifiers: ResolvedModifier[];
}): string[] {
  const errors: string[] = [];
  if (!/^T(?:00[1-9]|0[1-9][0-9]|10[0-2])$/.test(input.selection.templateId)) {
    errors.push('TEMPLATE_ID_OUTSIDE_CANONICAL_RANGE');
  }
  const trainingIndexes = trainingSessionIndexes(input.sessions);
  const recoveryIndexes = activeRecoverySessionIndexes(input.sessions);
  if (trainingIndexes.length !== input.selection.prescribedStructuredDays) {
    errors.push('STRUCTURED_SESSION_COUNT_MISMATCH');
  }
  // Schedule Engine V1 rotates numeric indexes. Keep all executable sessions
  // first and any non-executable recovery guidance after them so its cursor
  // can remain backward-compatible while recovery is represented explicitly.
  if (trainingIndexes.some((sessionIndex, orderIndex) => sessionIndex !== orderIndex)) {
    errors.push('TRAINING_SESSION_ORDER_INVALID');
  }
  if (recoveryIndexes.length > input.selection.requestedDays - input.selection.prescribedStructuredDays) {
    errors.push('RECOVERY_EXCEEDS_AVAILABLE_SLOTS');
  }
  if (input.selection.population !== 'conventional' && input.sessions.length > 4) {
    errors.push('SPECIAL_POPULATION_EXCEEDS_FOUR_SESSIONS');
  }
  for (const [sessionIndex, session] of input.sessions.entries()) {
    const sourceByFinalId = new Map<string, string>();
    for (const exercise of session.exercises) {
      if (!exerciseExists(exercise.exerciseId)) errors.push(`MISSING_EXERCISE:${exercise.exerciseId}`);
      const previousSource = sourceByFinalId.get(exercise.exerciseId);
      // Repetition already present in the immutable canonical template can
      // be intentional (e.g. work block + recovery block). Only flag a
      // collision introduced by composition, where two different sources
      // resolved to the same final exercise.
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
  for (const modifier of input.modifiers) {
    if (modifier.application === 'RULE_DEFINITION_REQUIRED') {
      errors.push(`UNRESOLVED_MODIFIER:${modifier.id}:${modifier.reasonCode}`);
    }
  }
  return [...new Set(errors)].sort();
}
