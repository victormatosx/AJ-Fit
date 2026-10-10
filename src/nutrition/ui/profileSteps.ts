import {
  NUTRITION_AMBIGUOUS_GOALS, type NutritionGoal, type NutritionProfile,
} from '../../types/nutrition';

export type ProfileDraft = Partial<Omit<NutritionProfile, 'updatedAt'>>;

/**
 * `src/types/nutrition.ts`'s own doc comment: `nutritionGoalCategory` is
 * required exactly when the inherited AJ Fit goal has no direct mapping.
 * Never guessed, never defaulted silently.
 */
export function needsNutritionGoalCategory(goal: NutritionGoal): boolean {
  return (NUTRITION_AMBIGUOUS_GOALS as readonly NutritionGoal[]).includes(goal);
}

/**
 * The ordered question sequence for the progressive Perfil Nutricional form
 * (`docs/nutrition/02_questionnaire/*`, `08_frontend/screens.md` §2).
 * `nutritionGoalCategory` is conditionally included right after the inherited
 * goal is known — never asked for a goal with a direct mapping (§6 of the
 * round brief).
 */
export type ProfileStepId =
  | 'nutritionGoalCategory' | 'progressionPace' | 'targetWeightKg' | 'nonTrainingActivityLevel'
  | 'mealSlots' | 'dietaryPattern' | 'preferredFoodIds' | 'usualFoodIds' | 'excludedFoodIds'
  | 'excludedAllergens' | 'supplements' | 'pregnant' | 'breastfeeding' | 'varietyPreference';

export function profileStepOrder(goal: NutritionGoal): ProfileStepId[] {
  const steps: ProfileStepId[] = [];
  if (needsNutritionGoalCategory(goal)) steps.push('nutritionGoalCategory');
  steps.push(
    'progressionPace', 'targetWeightKg', 'nonTrainingActivityLevel', 'mealSlots', 'dietaryPattern',
    'preferredFoodIds', 'usualFoodIds', 'excludedFoodIds', 'excludedAllergens', 'supplements',
    'pregnant', 'breastfeeding', 'varietyPreference',
  );
  return steps;
}

/** Per-step "can continue" rule — mirrors `QuestionRenderer.canContinueQuestion`'s intent for this domain. */
export function canContinueProfileStep(step: ProfileStepId, draft: ProfileDraft): boolean {
  switch (step) {
    case 'nutritionGoalCategory': return draft.nutritionGoalCategory != null;
    case 'progressionPace': return true; // optional — only required for body-composition goals, not enforced at UI gate level
    case 'targetWeightKg': return true; // optional
    case 'nonTrainingActivityLevel': return draft.nonTrainingActivityLevel != null;
    case 'mealSlots': return Array.isArray(draft.mealSlots) && draft.mealSlots.length >= 2 && draft.mealSlots.length <= 6;
    case 'dietaryPattern': return draft.dietaryPattern != null;
    case 'preferredFoodIds': return true; // optional
    case 'usualFoodIds': return true; // optional
    case 'excludedFoodIds': return true; // optional
    case 'excludedAllergens': return true; // optional
    case 'supplements': return true; // optional
    case 'pregnant': return typeof draft.pregnant === 'boolean';
    case 'breastfeeding': return typeof draft.breastfeeding === 'boolean';
    case 'varietyPreference': return draft.varietyPreference != null;
    default: return true;
  }
}

/** Whether every required field across the whole flow is present — the review step's final gate. */
export function isProfileDraftComplete(goal: NutritionGoal, draft: ProfileDraft): boolean {
  return profileStepOrder(goal).every((step) => canContinueProfileStep(step, draft));
}

/** `09_safety/nutrition_safety_rules.md` — current pregnancy/breastfeeding state blocks AI generation, never a bypass. */
export function isSafetyBlocked(draft: ProfileDraft): boolean {
  return draft.pregnant === true || draft.breastfeeding === true;
}
