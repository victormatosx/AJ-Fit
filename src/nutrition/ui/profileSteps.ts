import { resolveGoalCategory } from '../engine/resolveGoalCategory';
import type { ResolvedUnits } from '../../types/units';
import { weightToKg } from '../../units/weightConversions';

import {
  NUTRITION_AMBIGUOUS_GOALS, NUTRITION_PROGRESSION_PACES, type NutritionGoal, type NutritionProfile,
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
  | 'mealSlots' | 'preferredFoodIds' | 'excludedFoodIds'
  | 'excludedAllergens' | 'supplements' | 'varietyPreference';

export const PROFILE_STEP_IDS: readonly ProfileStepId[] = [
  'nutritionGoalCategory', 'progressionPace', 'targetWeightKg', 'nonTrainingActivityLevel',
  'mealSlots', 'preferredFoodIds', 'excludedFoodIds', 'excludedAllergens', 'supplements', 'varietyPreference',
];
export function profileStepOrder(goal: NutritionGoal): ProfileStepId[] {
  return PROFILE_STEP_IDS.filter((id) => id !== 'nutritionGoalCategory' || needsNutritionGoalCategory(goal));
}

/** Per-step "can continue" rule — mirrors `QuestionRenderer.canContinueQuestion`'s intent for this domain. */
export function canContinueProfileStep(step: ProfileStepId, draft: ProfileDraft, goal?: NutritionGoal): boolean {
  switch (step) {
    case 'nutritionGoalCategory': return draft.nutritionGoalCategory != null;
    case 'progressionPace': {
      if (!goal) return false;
      let category;
      try { category = resolveGoalCategory(goal, draft); } catch { return false; }
      return !['weight_loss', 'muscle_gain'].includes(category)
        || NUTRITION_PROGRESSION_PACES.includes(draft.progressionPace!);
    }
    case 'targetWeightKg': return draft.targetWeightKg == null
      || (Number.isFinite(draft.targetWeightKg) && draft.targetWeightKg > 0 && draft.targetWeightKg <= 500);
    case 'nonTrainingActivityLevel': return draft.nonTrainingActivityLevel != null;
    case 'mealSlots': return Array.isArray(draft.mealSlots) && draft.mealSlots.length >= 2 && draft.mealSlots.length <= 6;
    case 'preferredFoodIds': return true; // optional
    case 'excludedFoodIds': return true; // optional
    case 'excludedAllergens': return true; // optional
    case 'supplements': return true; // optional
    case 'varietyPreference': return draft.varietyPreference != null;
    default: return true;
  }
}

/** Whether every required field across the whole flow is present — the review step's final gate. */
export function isProfileDraftComplete(goal: NutritionGoal, draft: ProfileDraft): boolean {
  return profileStepOrder(goal).every((step) => canContinueProfileStep(step, draft, goal));
}

/** No selection reuses the existing unrestricted value; a second tap clears it. */
export function toggleDietaryPattern(current: NutritionProfile['dietaryPattern'] | undefined,
  selected: Exclude<NutritionProfile['dietaryPattern'], 'omnivore'>): NutritionProfile['dietaryPattern'] {
  return current === selected ? 'omnivore' : selected;
}

/** Keep historical answers (including safety flags/usual foods), without document metadata. */
export function profileDraftFromSaved(profile: NutritionProfile): ProfileDraft {
  const { updatedAt: _updatedAt, ...answers } = profile;
  return { ...answers, dietaryPattern: answers.dietaryPattern ?? 'omnivore' };
}

/** Empty means optional; invalid input must never silently turn into a skipped target. */
export function parseTargetWeightInput(text: string, units: ResolvedUnits): number | null {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d+(?:[.,]\d*)?$/.test(value)) return NaN;
  return weightToKg(Number(value.replace(',', '.')), units);
}

/** Defaults shared by both entry points; historical fields remain storage-compatible. */
export function emptyProfileDraft(): ProfileDraft {
  return { questionnaireVersion: 1, mealSlots: [], dietaryPattern: 'omnivore',
    preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [], excludedAllergens: [],
    supplements: [], pregnant: false, breastfeeding: false };
}
