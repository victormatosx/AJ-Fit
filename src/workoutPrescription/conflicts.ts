import type { ConflictResolution, QuestionnaireAnswers, ResolvedModifier } from './types';
import { normalizeExperience, normalizeGoal } from './input';

export function resolveConflicts(
  answers: QuestionnaireAnswers,
  modifiers: ResolvedModifier[],
): ConflictResolution[] {
  const conflicts: ConflictResolution[] = [];
  const has = (id: string) => modifiers.some((value) => value.id === id);
  const priorities = answers.muscleFocus.filter((value) => value !== 'none');
  const limitations = answers.limits.filter((value) => value !== 'none');

  if (normalizeExperience(answers.level) === 'advanced' && normalizeGoal(answers.goal) === 'return_to_training') {
    conflicts.push({
      id: 'return_over_advanced',
      winnerModifierId: 'goal:return_to_training',
      constrainedModifierId: 'experience:advanced',
      reasonCode: 'RECONDITIONING_PRECEDES_AGGRESSIVE_PROGRESSION',
    });
  }
  if (priorities.length && limitations.length) {
    for (const priority of priorities) {
      conflicts.push({
        id: `safety_over_priority:${priority}`,
        winnerModifierId: 'safety:musculoskeletal_adaptation',
        constrainedModifierId: `muscle_priority:${priority}`,
        reasonCode: 'SAFETY_CONSTRAINTS_FILTER_PRIORITY_OPTIONS',
      });
    }
  }
  if (answers.duration === '30' && priorities.length) {
    for (const priority of priorities) {
      conflicts.push({
        id: `duration_budget_with_priority:${priority}`,
        winnerModifierId: 'duration:30',
        constrainedModifierId: `muscle_priority:${priority}`,
        reasonCode: 'PRIORITY_MUST_REDISTRIBUTE_WITHIN_TIME_BUDGET',
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
  if (has('safety:lipedema_conservative') && limitations.length) {
    conflicts.push({
      id: 'lipedema_with_musculoskeletal_limitation',
      winnerModifierId: 'safety:musculoskeletal_adaptation',
      constrainedModifierId: 'safety:lipedema_conservative',
      reasonCode: 'INTERSECTION_OF_PROTECTED_CONSTRAINTS_REQUIRED',
    });
  }
  return conflicts;
}
