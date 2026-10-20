import {
  NON_TRAINING_ACTIVITY_LEVELS,
  NUTRITION_FOOD_ALLERGENS,
  NUTRITION_GOAL_CATEGORIES,
  NUTRITION_MEAL_SLOTS,
  NUTRITION_PROGRESSION_PACES,
  NUTRITION_SUPPLEMENT_IDS,
  VARIETY_PREFERENCES,
} from '../../types/nutrition';
import type { ProfileStepId } from '../../nutrition/ui/profileSteps';
import type { Question } from './QuestionRenderer';

/**
 * The nutrition block, described as ordinary questionnaire questions.
 *
 * Before this, every nutrition step rendered through
 * `NutritionProfileQuestion` — which draws `SelectableRow`/`SelectableChip`
 * from `NutritionPrimitives`. Those primitives are shared with fourteen
 * nutrition screens outside the funnel (the diary, the plan, food search, the
 * weekly summary), so restyling them to match the questionnaire would have
 * redesigned all of those too.
 *
 * Describing the steps as `Question`s instead lets `QuestionStepScreen` render
 * them with the SAME controls the training questions use — the ruled rows,
 * the radio, the lift-and-perch selection — while `NutritionPrimitives` stays
 * untouched for everyone else.
 *
 * Two steps are deliberately absent: `preferredFoodIds` and `excludedFoodIds`
 * are catalogue searches (and the latter also carries the dietary-pattern
 * rows), which no questionnaire `kind` describes. They keep rendering through
 * `NutritionProfileQuestion`.
 *
 * Nothing here is a rule. The option sets are the exported domain constants,
 * the order comes from `profileStepOrder`, and whether a step may advance
 * still comes from `canContinueProfileStep` — this module only says which
 * control draws it.
 */

const toOptions = (values: readonly string[]) => values.map((v) => ({ v }));

/** Mirrors the training questionnaire's own `weight` ruler, per the design. */
export const NUTRITION_TARGET_WEIGHT_RANGE = {
  min: 40,
  max: 180,
  default: 78,
  digits: { min: 2, max: 3 },
} as const;

export function nutritionFunnelQuestion(
  step: ProfileStepId,
  stepId: string,
): Question | null {
  switch (step) {
    case 'nutritionGoalCategory':
      return { id: stepId, kind: 'choice-large', options: toOptions(NUTRITION_GOAL_CATEGORIES) };
    case 'progressionPace':
      return { id: stepId, kind: 'choice-large', options: toOptions(NUTRITION_PROGRESSION_PACES) };
    case 'nonTrainingActivityLevel':
      return { id: stepId, kind: 'choice-large', options: toOptions(NON_TRAINING_ACTIVITY_LEVELS) };
    case 'varietyPreference':
      return { id: stepId, kind: 'choice-large', options: toOptions(VARIETY_PREFERENCES) };
    case 'mealSlots':
      // The 2–6 range is `canContinueProfileStep`'s; only the upper bound is
      // expressible as a control affordance, and it is passed on as one so
      // the rows beyond it recede instead of silently refusing a tap.
      return {
        id: stepId,
        kind: 'multi',
        options: toOptions(NUTRITION_MEAL_SLOTS),
        maxSelections: 6,
        layout: 'list',
      };
    case 'excludedAllergens':
      return { id: stepId, kind: 'multi', options: toOptions(NUTRITION_FOOD_ALLERGENS), layout: 'list' };
    case 'supplements':
      return { id: stepId, kind: 'multi', options: toOptions(NUTRITION_SUPPLEMENT_IDS), layout: 'list' };
    case 'targetWeightKg':
      return { id: stepId, kind: 'wheel', ...NUTRITION_TARGET_WEIGHT_RANGE };
    // Catalogue searches — see the note above.
    case 'preferredFoodIds':
    case 'excludedFoodIds':
      return null;
    default:
      return null;
  }
}

/**
 * Where each step's option copy lives in the `nutrition` namespace. Meal slots
 * are the one set whose labels are shared with the rest of the app and
 * therefore sit at the root rather than under the question.
 */
export function nutritionOptionKey(step: ProfileStepId, value: string): string {
  if (step === 'mealSlots') return `mealSlots.${value}`;
  return `profile.questions.${step}.options.${value}`;
}
