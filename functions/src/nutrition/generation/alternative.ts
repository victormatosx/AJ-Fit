import type { MealNutritionTarget, NutritionGoal, NutritionMealSlot, NutritionProfile } from '../shared/types/nutrition';
import { nutritionAiProfile, NutritionAiProviderError, type NutritionAiProvider } from '../ai/provider';
import { parseAiMealAlternativeOutput, validateAndBuildMealAlternative, type ValidatedMealAlternative } from './domain';
import { runReviewedGeneration, type AttemptAudit, type ReviewedGenerationOptions, type ReviewedResult } from './attempts';
import type { NutritionPromptFoodNames } from './foodNames';
import { inspectFoodEvidence } from './reviewEvidence';

export async function generateValidatedMealAlternative(
  provider: NutritionAiProvider, profile: NutritionProfile, slot: NutritionMealSlot, target: MealNutritionTarget,
  avoidFoodNames: readonly string[], goal: NutritionGoal, foodNames: NutritionPromptFoodNames,
  feedback: string | undefined, onAttempt: (audit: AttemptAudit) => Promise<void> = async () => {},
  options: ReviewedGenerationOptions = {},
): Promise<ReviewedResult<ValidatedMealAlternative>> {
  if (!provider.generateMealAlternative) throw new NutritionAiProviderError('AI_PROVIDER_ERROR', false);
  return runReviewedGeneration(provider, (_attempt, retryFeedback, timeoutMs) => provider.generateMealAlternative!({
    profile: nutritionAiProfile(profile), target, avoidFoodNames, goal, foodNames,
    feedback: retryFeedback, fallback: false, timeoutMs, physicalContext: options.physicalContext,
  }), async raw => {
    const parsed = parseAiMealAlternativeOutput(raw);
    const evidence = await inspectFoodEvidence(parsed.options.flatMap(o => o.foods), profile, foodNames, options.catalogSession);
    const validated = validateAndBuildMealAlternative(raw, slot, target, profile.excludedAllergens, true,
      { dietaryPattern: profile.dietaryPattern, excludedFoodNames: foodNames.excluded });
    const candidate = { recommendedOptionIndex: parsed.recommendedOptionIndex,
      options: validated.options.map((o, i) => ({ foods: o.foods.map((f, j) => ({ ...f, ingredients: parsed.options[i].foods[j].ingredients })) })) };
    return { validated, candidate, evidence };
  }, { profile: nutritionAiProfile(profile), targets: { slot, target }, goal, foodNames,
    physicalContext: options.physicalContext }, onAttempt, async () => {}, options, feedback);
}
