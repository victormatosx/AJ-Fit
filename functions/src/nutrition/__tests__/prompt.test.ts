import { describe, expect, it, vi } from 'vitest';
import { fullPlanContext, mealAlternativeContext } from '../ai/prompt';
import type { NutritionAiProfile } from '../ai/provider';
import { OpenAiNutritionProvider } from '../ai/provider';
import type { MealNutritionTarget, NutritionEngineOutput } from '../shared/types/nutrition';

const names = { preferred: [], usual: [], excluded: [] };
const baseProfile = {
  mealSlots: ['breakfast', 'lunch'], dietaryPattern: 'omnivore', excludedAllergens: [], excludedFoodIds: [],
  preferredFoodIds: [], usualFoodIds: [], supplements: ['whey_or_protein'], varietyPreference: 'low',
  questionnaireVersion: 1, nonTrainingActivityLevel: 'light',
} as unknown as NutritionAiProfile;
const engine = { mealTargets: [], energy: { targetKcal: 2000 }, macros: { proteinG: 150, carbsG: 200, fatG: 60, fiberG: 30 } } as unknown as NutritionEngineOutput;
const target = { kcal: { target: 500, min: 475, max: 525 }, proteinG: { target: 30, min: 27, max: 33 },
  carbsG: { target: 50, min: 45, max: 55 }, fatG: { target: 15, min: 13, max: 17 }, fiberG: { target: 5, min: 4, max: 6 } } as MealNutritionTarget;

describe('supplement selection is separate from backend verification and independent review', () => {
  it('carries the collected nutrition objective, activity, pace, target weight and supplement selection in both creator contexts', () => {
    const profile: NutritionAiProfile = { ...baseProfile, nutritionGoalCategory: 'maintenance', progressionPace: 'moderate', targetWeightKg: 68 };
    for (const raw of [fullPlanContext(profile, engine, 'health', names), mealAlternativeContext(profile, target, [], 'health', names)]) {
      expect(JSON.parse(raw)).toMatchObject({ nonTrainingActivityLevel: profile.nonTrainingActivityLevel,
        nutritionGoalCategory: 'maintenance', progressionPace: 'moderate', targetWeightKg: 68, supplements: ['whey_or_protein'] });
    }
  });
  it('forwards catalog mode through both provider HTTP contexts using only a mocked fetch', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      status: 'completed', output: [{ content: [{ type: 'output_text', text: '{}' }] }], model: 'fake',
    }), { status: 200 }));
    const provider = new OpenAiNutritionProvider('test-only', fetcher);
    const profile = { ...baseProfile, excludedSubstances: ['lactose'] as const };
    await provider.generatePlan({ profile: { ...profile, excludedSubstances: ['lactose'] }, engine, goal: 'health', foodNames: names, catalogMode: true });
    await provider.generateMealAlternative({ profile: { ...profile, excludedSubstances: ['lactose'] }, target, avoidFoodNames: [], goal: 'health', foodNames: names, catalogMode: true });
    for (const [, init] of fetcher.mock.calls) {
      const body = JSON.parse(String(init?.body));
      expect(JSON.parse(body.input.find((m: { role: string }) => m.role === 'user').content).wheyAccepted).toBe(true);
      expect(body.input.find((m: { role: string }) => m.role === 'developer').content).toContain('CATALOG INTENT MODE');
    }
  });
  it.each([
    ['omnivore', [], [], true, true],
    ['omnivore', [], ['lactose'], true, true],
    ['vegetarian', [], ['lactose'], true, true],
    ['vegan', [], ['lactose'], true, false],
    ['omnivore', ['milk'], [], true, false],
    ['omnivore', [], ['lactose'], false, false],
  ] as const)('catalog mode respects pattern=%s, allergens=%j, substances=%j, selected=%s', (pattern, allergens, substances, selected, whey) => {
    const p = { ...baseProfile, dietaryPattern: pattern, excludedAllergens: [...allergens],
      excludedSubstances: [...substances], supplements: selected ? ['whey_or_protein'] : [] } as NutritionAiProfile;
    const contexts = [fullPlanContext(p, engine, 'health', names, undefined, true),
      mealAlternativeContext(p, target, [], 'health', names, undefined, true)];
    for (const raw of contexts) {
      const ctx = JSON.parse(raw);
      expect(ctx.wheyAccepted).toBe(whey);
      expect(ctx.proteinSupplementAccepted).toBe(selected);
      expect(ctx.supplementSafety).toContain('backend-verified lactose absence');
      expect(ctx.supplementSafety).toContain('Never invent product properties');
    }
  });
  it('accepts whey for an unrestricted profile with the supplement selected', () => {
    const ctx = JSON.parse(fullPlanContext(baseProfile, engine, 'health', names));
    expect(ctx.wheyAccepted).toBe(true);
  });
  it('rejects whey for a vegan profile regardless of the supplement selection', () => {
    const ctx = JSON.parse(fullPlanContext({ ...baseProfile, dietaryPattern: 'vegan' }, engine, 'health', names));
    expect(ctx.wheyAccepted).toBe(false);
  });
  it('rejects whey for a legacy milk-allergy profile', () => {
    const ctx = JSON.parse(fullPlanContext({ ...baseProfile, excludedAllergens: ['milk'] }, engine, 'health', names));
    expect(ctx.wheyAccepted).toBe(false);
  });
  it('permits considering whey for lactose intolerance; evidence is checked against the actual proposed product', () => {
    const ctx = JSON.parse(fullPlanContext({ ...baseProfile, excludedSubstances: ['lactose'] }, engine, 'health', names));
    expect(ctx.wheyAccepted).toBe(true);
  });
  it('rejects whey without the supplement selected, independent of restrictions', () => {
    const ctx = JSON.parse(fullPlanContext({ ...baseProfile, supplements: [] }, engine, 'health', names));
    expect(ctx.wheyAccepted).toBe(false);
  });
  it('applies the same lactose rule to the meal-alternative prompt', () => {
    const ctx = JSON.parse(mealAlternativeContext({ ...baseProfile, excludedSubstances: ['lactose'] }, target, [], 'health', names));
    expect(ctx.wheyAccepted).toBe(true);
    const unrestricted = JSON.parse(mealAlternativeContext(baseProfile, target, [], 'health', names));
    expect(unrestricted.wheyAccepted).toBe(true);
  });
});
