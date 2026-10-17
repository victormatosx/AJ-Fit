import { emptyProfileDraft, parseTargetWeightInput, type ProfileDraft } from '../nutrition/ui/profileSteps';
import type { OnboardingCustomFood } from '../nutrition/catalog/onboardingCatalog';
import type { ResolvedUnits } from '../types/units';

export interface OnboardingNutritionDraft {
  answers: ProfileDraft;
  targetWeightText: string;
  targetWeightUnits: ResolvedUnits;
  customFoods: OnboardingCustomFood[];
  completed: boolean;
}
export function emptyOnboardingNutrition(): OnboardingNutritionDraft {
  return { answers: emptyProfileDraft(), targetWeightText: '', targetWeightUnits: 'metric', customFoods: [], completed: false };
}
/** Invalid text stays invalid across JSON serialization (NaN itself cannot survive JSON). */
export function nutritionDraftAnswers(value: OnboardingNutritionDraft): ProfileDraft {
  return { ...value.answers, targetWeightKg: parseTargetWeightInput(value.targetWeightText, value.targetWeightUnits) };
}

/** Defensive boundary for local JSON. Persistence remains the final domain validator. */
export function restoreOnboardingNutrition(raw: unknown): OnboardingNutritionDraft {
  const empty = emptyOnboardingNutrition();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const value = raw as Partial<OnboardingNutritionDraft>;
  const answers = value.answers && typeof value.answers === 'object' ? { ...empty.answers, ...value.answers } : empty.answers;
  for (const key of ['mealSlots', 'preferredFoodIds', 'usualFoodIds', 'excludedFoodIds', 'excludedAllergens', 'supplements'] as const) {
    if (!Array.isArray(answers[key])) delete answers[key];
  }
  return { answers, targetWeightText: typeof value.targetWeightText === 'string' ? value.targetWeightText : '',
    targetWeightUnits: value.targetWeightUnits === 'imperial' ? 'imperial' : 'metric',
    customFoods: Array.isArray(value.customFoods) ? value.customFoods.filter((food) => food && typeof food.id === 'string'
      && food.id.startsWith('custom_') && typeof food.name === 'string' && food.nutritionPer100g != null) : [],
    completed: value.completed === true };
}
