import { describe, expect, it, vi } from 'vitest';
import type { MealNutritionTarget, NutritionProfile } from '../shared/types/nutrition';
import { OpenAiNutritionProvider, OPENAI_MEAL_ALTERNATIVE_SCHEMA, type MealAlternativeRequest, type NutritionAiProvider } from '../ai/provider';
import { validateAndBuildMealAlternative, parseAiMealAlternativeOutput, PlanValidationError } from '../generation/domain';
import { generateValidatedMealAlternative } from '../generation/alternative';
import { GenerationAttemptsExhausted } from '../generation/attempts';
import { recommendedOptionFoodNames } from '../generation/mealAlternativeShared';
import type { NutritionPromptFoodNames } from '../generation/foodNames';

const profile: NutritionProfile = {
  questionnaireVersion: 1, nonTrainingActivityLevel: 'active', mealSlots: ['lunch'],
  dietaryPattern: 'omnivore', preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [],
  supplements: [], pregnant: false, breastfeeding: false, varietyPreference: 'indifferent', updatedAt: null,
};
const noNames: NutritionPromptFoodNames = { preferred: [], usual: [], excluded: [] };
const ranges = (target: number) => ({ min: target * 0.9, target, max: target * 1.1 });
const target: MealNutritionTarget = {
  slot: 'lunch', kcal: ranges(600), proteinG: ranges(30), carbsG: ranges(75), fatG: ranges(15), fiberG: ranges(15),
};
function item(name: string, kcal: number, proteinG: number, carbsG: number, fatG: number, fiberG: number,
  allergens: string[] = []) {
  return { name, quantity: 150, unit: 'g', preparationNote: '',
    estimatedNutrition: { kcal, proteinG, carbsG, fatG, fiberG }, allergens };
}
/** `scale` uniformly scales ALL of one item's macros away from the exact target — exercises the deterministic scale-and-recheck correction (every field must land back in range together, not just kcal). */
function output(scale = 1, name = 'Frango grelhado com batata doce') {
  const foods = [item(name, 600 * scale, 30 * scale, 75 * scale, 15 * scale, 15 * scale)];
  return { recommendedOptionIndex: 0, options: [{ foods }, { foods }] };
}
function fakeProvider(...outputs: unknown[]): NutritionAiProvider {
  const generateMealAlternative = vi.fn().mockImplementation(async () => {
    const next = outputs.shift();
    if (next instanceof Error) throw next;
    return { output: next, model: 'fake', usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }, latencyMs: 1 };
  });
  return { generatePlan: vi.fn(), generateMealAlternative };
}

describe('meal alternative validator — free-form AI items, no catalog/foodId dependency', () => {
  it('accepts a valid alternative scoped to the one meal target', () => {
    const result = validateAndBuildMealAlternative(output(), 'lunch', target);
    expect(result.options).toHaveLength(2);
    expect(result.recommendedOptionId).toBe('lunch-1');
    expect(result.options[0].foods[0].name).toBe('Frango grelhado com batata doce');
  });

  it('rejects malformed shapes without ever needing a catalog lookup', () => {
    expect(() => parseAiMealAlternativeOutput({ recommendedOptionIndex: 0, options: [{ foods: [] }] })).toThrow(PlanValidationError);
    expect(() => validateAndBuildMealAlternative({ meals: [] }, 'lunch', target)).toThrow('invalid_schema');
  });

  it('corrects quantity+estimatedNutrition deterministically and rejects impossible macro ratios', () => {
    const corrected = validateAndBuildMealAlternative(output(0.5), 'lunch', target);
    expect(corrected.corrected).toBe(true);
    const impossible = output(0, 'Água');
    expect(() => validateAndBuildMealAlternative(impossible, 'lunch', target)).toThrow('meal_target_deviation');
  });

  it('never recalculates the meal target itself — same target in, same bounds enforced', () => {
    expect(() => validateAndBuildMealAlternative(output(5), 'lunch', target)).toThrow();
  });

  it('still enforces the one deterministic safety check left — self-declared allergens against excludedAllergens', () => {
    const withShellfish = { recommendedOptionIndex: 0, options: [
      { foods: [item('Camarão', 600, 30, 75, 15, 15, ['shellfish'])] },
      { foods: [item('Camarão', 600, 30, 75, 15, 15, ['shellfish'])] },
    ] };
    expect(() => validateAndBuildMealAlternative(withShellfish, 'lunch', target, ['shellfish'])).toThrow('unsafe_allergen');
    expect(() => validateAndBuildMealAlternative(withShellfish, 'lunch', target, [])).not.toThrow();
  });
});

describe('generateValidatedMealAlternative', () => {
  it('uses the first valid attempt and reports no fallback', async () => {
    const provider = fakeProvider(output());
    const result = await generateValidatedMealAlternative(provider, profile, 'lunch', target, ['Frango à milanesa'], 'lose_fat', noNames, undefined);
    expect(result.attempt).toBe(1);
    expect(result.fallback).toBe(false);
    expect(provider.generateMealAlternative).toHaveBeenCalledTimes(1);
  });

  it('retries on invalid output and falls back on the last attempt for selected failures', async () => {
    const provider = fakeProvider({ recommendedOptionIndex: 0, options: [] }, { recommendedOptionIndex: 0, options: [] }, output());
    const result = await generateValidatedMealAlternative(provider, profile, 'lunch', target, [], 'lose_fat', noNames, undefined);
    expect(result.attempt).toBe(3);
    expect(result.fallback).toBe(true);
  });

  it('never exceeds 3 total calls and throws GenerationAttemptsExhausted', async () => {
    const provider = fakeProvider({ recommendedOptionIndex: 0, options: [] }, { recommendedOptionIndex: 0, options: [] }, { recommendedOptionIndex: 0, options: [] });
    await expect(generateValidatedMealAlternative(provider, profile, 'lunch', target, [], 'lose_fat', noNames, undefined))
      .rejects.toBeInstanceOf(GenerationAttemptsExhausted);
    expect(provider.generateMealAlternative).toHaveBeenCalledTimes(3);
  });

  it('respects self-declared allergens exactly like the full-plan validator', async () => {
    const unsafeOutput = { recommendedOptionIndex: 0, options: [
      { foods: [item('Camarão', 600, 30, 75, 15, 15, ['shellfish'])] },
      { foods: [item('Camarão', 600, 30, 75, 15, 15, ['shellfish'])] },
    ] };
    const provider = fakeProvider(unsafeOutput);
    await expect(generateValidatedMealAlternative(provider, { ...profile, excludedAllergens: ['shellfish'] }, 'lunch', target,
      [], 'lose_fat', noNames, undefined)).rejects.toMatchObject({ code: 'AI_SAFETY_VALIDATION_FAILED' });
    expect(provider.generateMealAlternative).toHaveBeenCalledTimes(1);
  });
});

describe('recommendedOptionFoodNames', () => {
  it('returns the recommended option foods by name, empty if the option id is missing', () => {
    const meal = { recommendedOptionId: 'o1', options: [{ id: 'o1', foods: [{ name: 'Arroz' }, { name: 'Feijão' }] }] };
    expect(recommendedOptionFoodNames(meal)).toEqual(['Arroz', 'Feijão']);
    expect(recommendedOptionFoodNames({ recommendedOptionId: 'missing', options: [] })).toEqual([]);
  });
});

describe('meal alternative provider schema', () => {
  it('matches the shared meal-options schema (no slot/recommendedOptionIndex at the top level beyond this)', () => {
    expect(OPENAI_MEAL_ALTERNATIVE_SCHEMA.required).toEqual(['recommendedOptionIndex', 'options']);
  });

  it('uses the cheaper mealAlternative model, and the fallback model only when requested', async () => {
    const calls: unknown[] = [];
    const fetcher = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(init.body as string).model);
      return new Response(JSON.stringify({ status: 'completed', model: 'fake',
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(output()) }] }],
        usage: { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } } }), { status: 200 });
    });
    const provider = new OpenAiNutritionProvider('secret', fetcher);
    const request: MealAlternativeRequest = { profile, target, avoidFoodNames: [], goal: 'lose_fat', foodNames: noNames };
    await provider.generateMealAlternative!(request);
    await provider.generateMealAlternative!({ ...request, fallback: true });
    expect(calls[0]).not.toBe(calls[1]);
  });
});
