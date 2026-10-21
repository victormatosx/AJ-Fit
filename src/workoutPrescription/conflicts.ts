import { normalizeExperience } from './input';
import type { ConflictResolution,QuestionnaireAnswers,ResolvedModifier } from './types';

/**
 * Legacy v2.0/T001-T090 conflict resolution between `resolveModifiers`
 * output (P0-P7 matrix). Read only by `engine.ts`. Not used by the v1.27
 * pipeline — see `modifiers.ts`'s file doc for the same boundary.
 */

export function resolveConflicts(
  answers: QuestionnaireAnswers,
  _modifiers: ResolvedModifier[],
): ConflictResolution[] {
  const conflicts: ConflictResolution[] = [];
  const priorities = answers.muscleFocus.filter((value) => value !== 'none');


  if (answers.duration === '30' && priorities.length) {
    for (const priority of priorities) {
      conflicts.push({
        id: `duration_limits_priority_extra_set:${priority}`,
        winnerModifierId: 'duration:30',
        constrainedModifierId: `muscle_priority:${priority}`,
        reasonCode: 'THIRTY_MINUTES_DISALLOWS_PRIORITY_EXTRA_SET',
      });
    }
  }
  if (answers.duration === '90' && ['never_or_starting', 'beginner'].includes(normalizeExperience(answers.level) ?? '')) {
    conflicts.push({
      id: 'beginner_over_available_time',
      winnerModifierId: `experience:${normalizeExperience(answers.level)}`,
      constrainedModifierId: 'duration:90',
      reasonCode: 'AVAILABLE_TIME_DOES_NOT_INCREASE_BEGINNER_DOSE',
    });
  }

  return conflicts;
}
