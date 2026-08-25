import type { FinalWorkoutSession, ResolvedModifier, SelectionDecision } from './types';
import { exerciseExists } from './composition';

export function validateFinalWorkout(input: {
  selection: SelectionDecision;
  sessions: FinalWorkoutSession[];
  modifiers: ResolvedModifier[];
}): string[] {
  const errors: string[] = [];
  if (!/^T(?:00[1-9]|0[1-8][0-9]|090)$/.test(input.selection.templateId)) {
    errors.push('TEMPLATE_ID_OUTSIDE_CANONICAL_RANGE');
  }
  if (input.sessions.length !== input.selection.prescribedStructuredDays) {
    errors.push('STRUCTURED_SESSION_COUNT_MISMATCH');
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
      if (exercise.sets == null && exercise.duration == null) {
        errors.push(`INVALID_EXERCISE_DOSE:${sessionIndex}:${exercise.exerciseId}`);
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
