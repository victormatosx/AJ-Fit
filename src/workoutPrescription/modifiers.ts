import { normalizeExperience,normalizeGoal } from './input';
import { adaptationStage,isBeginnerExperience } from './personalization';
import type { QuestionnaireAnswers,ResolvedModifier,SafetyDecision } from './types';

/**
 * Legacy v2.0/T001-T090 modifier resolution (P0-P7 priority matrix). Read
 * only by `engine.ts`'s `generateWorkoutPrescription`, which still drives
 * the active runtime. The v1.27 pipeline (`selectorV127.ts` +
 * `compositionV127.ts`) does not import this module and never will for
 * beginner/duration/goal/equipment/experience/special-population effects —
 * those already happened once, structurally, in template *selection* (see
 * `compositionV127.ts`'s file doc). Do not add a v1.27 call site here.
 */

function modifier(
  id: string,
  priority: ResolvedModifier['priority'],
  application: ResolvedModifier['application'],
  reasonCode: string,
  protectedConstraints?: string[],
): ResolvedModifier {
  return { id, priority, application, reasonCode, protectedConstraints };
}

/**
 * Resolves intent without pretending that an undocumented numeric dose or
 * clinical substitution exists. `RULE_DEFINITION_REQUIRED` is deliberately a
 * first-class result: composition will fail closed instead of mutating the
 * canonical template by opinion.
 */
export function resolveModifiers(
  answers: QuestionnaireAnswers,
  safety: SafetyDecision,
  adaptationWeek?: number,
): ResolvedModifier[] {
  const result: ResolvedModifier[] = [];

  for (const id of safety.requiredModifierIds) {
    if (id.startsWith('population:')) {
      result.push(modifier(id, 'P1', 'APPLIED', 'SPECIAL_POPULATION_BASE_TEMPLATE'));
    } else {
      result.push(modifier(
        id,
        'P0',
        'RULE_DEFINITION_REQUIRED',
        'SAFE_EXECUTABLE_TRANSFORMATION_NOT_DOCUMENTED',
        safety.protectedConstraints,
      ));
    }
  }

  if (answers.place === 'home') {
    result.push(modifier('equipment:available_inventory', 'P3', 'APPLIED', 'HOME_INVENTORY_FILTER'));
    // `equipment: ['other']` is a real, always-offered UI option — never a
    // signal to fail closed. `equipmentContextFor` (equipment.ts) already
    // treats an unmapped equipment id as contributing nothing beyond the
    // bodyweight baseline, exactly like leaving it unselected; there is
    // nothing left here for a modifier to resolve or block on.
  }

  const experience = normalizeExperience(answers.level);
  if (isBeginnerExperience(answers)) {
    const stage = adaptationStage(adaptationWeek);
    result.push(modifier(
      `experience:${experience}`,
      'P4',
      stage < 3 ? 'APPLIED' : 'DECLARATIVE',
      stage < 3 ? `BEGINNER_WEEK_${stage}_EXERCISE_REDUCTION` : 'BEGINNER_ADAPTATION_COMPLETE',
    ));
  } else if (experience === 'intermediate' || experience === 'advanced') {
    result.push(modifier(`experience:${experience}`, 'P4', 'DECLARATIVE', 'PRESERVE_BASE_DOSE'));
  }

  const goal = normalizeGoal(answers.goal);
  if (goal === 'return_to_training') {
    result.push(modifier(
      'goal:return_to_training',
      'P2',
      'DECLARATIVE',
      'RETURN_TO_TRAINING_PRESERVES_SELECTED_TEMPLATE',
    ));
  } else if (goal === 'lose_fat' || goal === 'body_composition') {
    result.push(modifier(`goal:${goal}`, 'P6', 'DECLARATIVE', 'PRESERVE_RESISTANCE_BASE'));
  }

  const priorities = answers.muscleFocus.filter((value) => value !== 'none').slice(0, 2);
  for (const priority of priorities) {
    result.push(modifier(
      `muscle_priority:${priority}`,
      'P7',
      'APPLIED',
      'SIMPLE_PRIORITY_PRESERVE_ORDER_AND_OPTIONAL_SET',
    ));
  }

  if (answers.duration === '30' || answers.duration === '45') {
    result.push(modifier(
      `duration:${answers.duration}`,
      'P5',
      'APPLIED',
      'APPROXIMATE_EXERCISE_COUNT_REDUCTION',
    ));
  } else if (answers.duration === '60') {
    result.push(modifier('duration:60', 'P5', 'DECLARATIVE', 'PRESERVE_BASE_SESSION'));
  } else if (answers.duration === '90') {
    result.push(modifier('duration:90', 'P5', 'DECLARATIVE', 'AVAILABLE_TIME_DOES_NOT_FORCE_VOLUME'));
  }

  // Stable priority ordering is part of the engine contract. Modern JS sort
  // is stable, so modifiers at the same priority retain their questionnaire/
  // resolver order while P0 can never be applied after a preference.
  return result.sort((left, right) =>
    Number(left.priority.slice(1)) - Number(right.priority.slice(1)),
  );
}
