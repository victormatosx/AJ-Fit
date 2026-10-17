import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as backendLogger from '../../lib/logger';
import type { NutritionEngineOutput, NutritionProfile } from '../shared/types/nutrition';
import { OpenAiNutritionProvider, OPENAI_PLAN_SCHEMA, OPENAI_REQUEST_TIMEOUT_MS, type NutritionAiProvider } from '../ai/provider';
import { NUTRITION_AI_MODELS } from '../ai/config';
import { fullPlanContext, mealAlternativeContext } from '../ai/prompt';
import { validateAndBuildPlan } from '../generation/domain';
import { generateValidatedPlan, GenerationAttemptsExhausted } from '../generation/attempts';
import { resolveBackendWorkoutFrequency, resolveNutritionWeightKg } from '../generation/context';
import { nutritionRolloutBucket } from '../generation/rollout';
import type { NutritionPromptFoodNames } from '../generation/foodNames';

const profile: NutritionProfile = {
  questionnaireVersion: 1, nonTrainingActivityLevel: 'active', mealSlots: ['breakfast', 'lunch'],
  dietaryPattern: 'omnivore', preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [],
  supplements: [], pregnant: false, breastfeeding: false, varietyPreference: 'indifferent', updatedAt: null,
};
const goal = 'lose_fat';
const noNames: NutritionPromptFoodNames = { preferred: [], usual: [], excluded: [] };
const ranges = (target: number) => ({ min: target * 0.9, target, max: target * 1.1 });
const engine: NutritionEngineOutput = {
  eligible: true, blockers: [], energy: { rmrKcal: 900, tdeeKcal: 1100, targetKcal: 1000, safetyClampApplied: false },
  macros: { proteinG: 50, carbsG: 125, fatG: 25, fiberG: 25 },
  mealTargets: [
    { slot: 'breakfast', kcal: ranges(400), proteinG: ranges(20), carbsG: ranges(50), fatG: ranges(10), fiberG: ranges(10) },
    { slot: 'lunch', kcal: ranges(600), proteinG: ranges(30), carbsG: ranges(75), fatG: ranges(15), fiberG: ranges(15) },
  ], calculationTrace: {}, versions: { nutritionEngineVersion: '1.0.0', energyRulesVersion: '1.0.0',
    macroRulesVersion: '1.0.0', mealDistributionVersion: '1.0.0', questionnaireVersion: 1, foodCatalogVersion: 'v1' },
};
/** A free-form AI item — no foodId, self-estimated nutrition, self-declared allergens. */
function item(name: string, kcal: number, proteinG: number, carbsG: number, fatG: number, fiberG: number,
  allergens: string[] = []) {
  return { name, ingredients: [{ name, origin: 'plant' as const }], quantity: 100, unit: 'g', preparationNote: '',
    estimatedNutrition: { kcal, proteinG, carbsG, fatG, fiberG }, allergens };
}
/** `scale` uniformly scales ALL of one item's macros away from the exact target — exercises the deterministic scale-and-recheck correction (every field must land back in range together, not just kcal). */
function output(breakfastScale = 1, lunchScale = 1) {
  const breakfastItem = item('Mingau de aveia', 400 * breakfastScale, 20 * breakfastScale,
    50 * breakfastScale, 10 * breakfastScale, 10 * breakfastScale);
  const lunchItem = item('Frango grelhado com arroz e feijão', 600 * lunchScale, 30 * lunchScale,
    75 * lunchScale, 15 * lunchScale, 15 * lunchScale);
  // Cost pass (2026-10-10): the full-plan AI output is now exactly one
  // option per meal — no options array/recommendedOptionIndex wrapper.
  return { meals: [
    { slot: 'breakfast', foods: [breakfastItem] },
    { slot: 'lunch', foods: [lunchItem] },
  ] };
}
function fakeProvider(...outputs: unknown[]): NutritionAiProvider {
  const generatePlan = vi.fn().mockImplementation(async () => {
    const next = outputs.shift();
    if (next instanceof Error) throw next;
    return { output: next, model: 'fake', usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 5 }, latencyMs: 1 };
  });
  return { generatePlan };
}

describe('deterministic validator — free-form AI items, no catalog/foodId dependency (diet-quality-v3, 2026-10-10)', () => {
  it('accepts a valid plan and computes macros from the AI\'s own estimated nutrition', () => {
    const plan = validateAndBuildPlan(output(), profile.mealSlots, engine);
    expect(plan.dailyTotals).toMatchObject({ kcal: 1000, proteinG: 50 });
    expect(plan.meals[0].options[0].foods[0]).toMatchObject({ name: 'Mingau de aveia', quantity: 100, unit: 'g' });
    expect(plan.meals[1].recommendedOptionId).toBe('lunch-1');
  });
  it('rejects malformed shapes without ever needing a catalog lookup', () => {
    expect(() => validateAndBuildPlan({ ...output(), macros: 999 }, profile.mealSlots, engine)).toThrow('invalid_schema');
    const badQuantity = output();
    badQuantity.meals[0].foods[0].quantity = -1;
    expect(() => validateAndBuildPlan(badQuantity, profile.mealSlots, engine)).toThrow('invalid_schema');
    const missingAllergens = output();
    // @ts-expect-error — deliberately malformed to prove the shape is enforced without a catalog
    delete missingAllergens.meals[0].foods[0].allergens;
    expect(() => validateAndBuildPlan(missingAllergens, profile.mealSlots, engine)).toThrow('invalid_schema');
  });
  it('still enforces the one deterministic safety check left — self-declared allergens against excludedAllergens', () => {
    const withMilk = output();
    withMilk.meals[0].foods[0] = item('Iogurte', 400, 20, 50, 10, 10, ['milk']);
    expect(() => validateAndBuildPlan(withMilk, profile.mealSlots, engine, ['milk'])).toThrow('unsafe_allergen');
    expect(() => validateAndBuildPlan(withMilk, profile.mealSlots, engine, [])).not.toThrow();
  });
  it('corrects quantity+estimatedNutrition together, deterministically, without changing item names; rejects impossible macro ratios', () => {
    const first = validateAndBuildPlan(output(0.5, 0.5), profile.mealSlots, engine);
    const second = validateAndBuildPlan(output(0.5, 0.5), profile.mealSlots, engine);
    expect(first).toEqual(second);
    expect(first.corrected).toBe(true);
    expect(first.meals[0].options[0].foods[0].name).toBe('Mingau de aveia');
    // `estimatedNutrition` is optional on the shared type only for a
    // pre-diet-quality-v3 persisted document (see its comment in
    // shared/types/nutrition.ts) — domain.ts always populates it for
    // anything it builds itself, so a `!` here is sound, not a type-safety hole.
    expect(first.meals[0].options[0].foods[0].estimatedNutrition!.kcal).toBeCloseTo(400, 0);
    const impossible = output();
    impossible.meals[0].foods[0] = item('Água', 0, 0, 0, 0, 0);
    expect(() => validateAndBuildPlan(impossible, profile.mealSlots, engine)).toThrow('meal_target_deviation');
  });
  it('builds exactly one option per meal on the initial full-plan generation (cost pass, 2026-10-10)', () => {
    const plan = validateAndBuildPlan(output(), profile.mealSlots, engine);
    expect(plan.meals[0].options).toHaveLength(1);
    expect(plan.meals[1].options).toHaveLength(1);
    expect(plan.meals[0].recommendedOptionId).toBe('breakfast-1');
  });
});

describe('prompt payload — backend sends numbers/safety, AI gets freedom over composition (no candidates, no foodId)', () => {
  it('full-plan context sends targets, slot names/count, goal, preferences-by-name, exclusions-by-name, allergens and diet', () => {
    const richProfile: NutritionProfile = {
      ...profile, excludedFoodIds: ['excluded-food'], excludedAllergens: ['milk'], dietaryPattern: 'vegetarian',
      supplements: ['whey_or_protein'],
    };
    const names: NutritionPromptFoodNames = { preferred: ['Arroz'], usual: ['Feijão'], excluded: ['Amendoim'] };
    const payload = JSON.parse(fullPlanContext(richProfile, engine, 'lose_fat', names, undefined));
    expect(payload.mealSlots).toEqual(['breakfast', 'lunch']);
    expect(payload.mealTargets).toHaveLength(2);
    // `dailyTargets` deliberately omitted (cost pass, 2026-10-10) — it's
    // just the sum of `mealTargets`, already sent above.
    expect(payload).not.toHaveProperty('dailyTargets');
    expect(payload.goal).toBe('lose_fat');
    expect(payload.dietaryPattern).toBe('vegetarian');
    expect(payload.preferredFoodNames).toEqual(['Arroz']);
    expect(payload.usualFoodNames).toEqual(['Feijão']);
    expect(payload.excludedFoodNames).toEqual(['Amendoim']);
    expect(payload.excludedAllergens).toEqual(['milk']);
    expect(payload.wheyAccepted).toBe(false);
    expect(payload).not.toHaveProperty('candidates');
  });

  it('meal-alternative context sends the avoid-by-name list and exclusions/allergens the same way', () => {
    const richProfile: NutritionProfile = { ...profile, excludedFoodIds: ['excluded-food'], excludedAllergens: ['egg'] };
    const payload = JSON.parse(mealAlternativeContext(richProfile, engine.mealTargets[0],
      ['Frango à milanesa'], 'gain_muscle', noNames, undefined));
    expect(payload.avoidFoodNames).toEqual(['Frango à milanesa']);
    expect(payload.excludedAllergens).toEqual(['egg']);
    expect(payload.goal).toBe('gain_muscle');
    expect(payload).not.toHaveProperty('candidates');
  });
});

describe('bounded attempts and provider', () => {
  it('keeps the strict provider structure aligned with the canonical output schema', () => {
    const canonical = JSON.parse(readFileSync('../docs/nutrition/canonical/ai_output_schema.json', 'utf8')) as {
      required: string[]; properties: { meals: { items: { properties: { slot: { enum: string[] } } } } } };
    expect(OPENAI_PLAN_SCHEMA.required).toEqual(canonical.required);
    expect(OPENAI_PLAN_SCHEMA.properties.meals.items.properties.slot.enum).toEqual(canonical.properties.meals.items.properties.slot.enum);
  });
  it('routes to Luna as primary/retry for both operations, Sol only as final fallback, Astra never used (cost pass, 2026-10-10)', async () => {
    expect(NUTRITION_AI_MODELS.fullPlan).toBe('gpt-6-luna');
    expect(NUTRITION_AI_MODELS.mealAlternative).toBe('gpt-6-luna');
    expect(NUTRITION_AI_MODELS.fallback).toBe('gpt-6.1-sol');
    expect(Object.values(NUTRITION_AI_MODELS)).not.toContain('gpt-6-astra');

    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'completed', model: 'fake',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(output()) }] }],
      usage: { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } } }), { status: 200 }));
    const provider = new OpenAiNutritionProvider('test-secret', fetcher);
    await provider.generatePlan({ profile, engine, goal, foodNames: noNames });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe('gpt-6-luna');
    await provider.generatePlan({ profile, engine, goal, foodNames: noNames, fallback: true });
    expect(JSON.parse(fetcher.mock.calls[1][1].body).model).toBe('gpt-6.1-sol');
    await provider.generateMealAlternative({ profile, target: engine.mealTargets[0], avoidFoodNames: [], goal, foodNames: noNames });
    expect(JSON.parse(fetcher.mock.calls[2][1].body).model).toBe('gpt-6-luna');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).reasoning).toEqual({ effort: 'low' });
  });
  it('uses first valid attempt, correction, retry and strong fallback only for selected failures', async () => {
    const immediate = fakeProvider(output());
    expect((await generateValidatedPlan(immediate, profile, engine, goal, noNames)).attempt).toBe(1);
    expect(immediate.generatePlan).toHaveBeenCalledTimes(1);
    expect((await generateValidatedPlan(fakeProvider(output(0.5, 0.5)), profile, engine, goal, noNames)).validated.corrected).toBe(true);
    const retry = fakeProvider({ meals: [] }, output());
    expect((await generateValidatedPlan(retry, profile, engine, goal, noNames)).attempt).toBe(2);
    const fallback = fakeProvider({ meals: [] }, { meals: [] }, output());
    expect((await generateValidatedPlan(fallback, profile, engine, goal, noNames)).fallback).toBe(true);
    expect(fallback.generatePlan).toHaveBeenNthCalledWith(3, expect.objectContaining({ fallback: true }));
  });
  it('stops on safety failure and caps exhausted attempts', async () => {
    const unsafeOutput = output();
    unsafeOutput.meals[0].foods[0] = item('Amendoim', 400, 20, 50, 10, 10, ['peanut']);
    const unsafeProvider = fakeProvider(unsafeOutput);
    await expect(generateValidatedPlan(unsafeProvider, { ...profile, excludedAllergens: ['peanut'] }, engine, goal, noNames))
      .rejects.toMatchObject({ code: 'AI_SAFETY_VALIDATION_FAILED' });
    expect(unsafeProvider.generatePlan).toHaveBeenCalledTimes(1);
    const exhausted = fakeProvider({ meals: [] }, { meals: [] }, { meals: [] });
    await expect(generateValidatedPlan(exhausted, profile, engine, goal, noNames)).rejects.toBeInstanceOf(GenerationAttemptsExhausted);
    expect(exhausted.generatePlan).toHaveBeenCalledTimes(3);
    const resumed = fakeProvider(output());
    expect((await generateValidatedPlan(resumed, profile, engine, goal, noNames,
      async () => {}, async () => {}, { startAttempt: 3, previousFailureCode: 'AI_SCHEMA_INVALID' })).fallback).toBe(true);
    expect(resumed.generatePlan).toHaveBeenCalledTimes(1);
  });
  it('parses Responses API metadata and handles schema/provider/timeout without real API', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', model: 'fake',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(output()) }] }],
      usage: { input_tokens: 33, output_tokens: 22, input_tokens_details: { cached_tokens: 11 } } }), { status: 200 }));
    const provider = new OpenAiNutritionProvider('test-secret', fetcher);
    expect((await provider.generatePlan({ profile, engine, goal, foodNames: noNames })).usage)
      .toEqual({ inputTokens: 33, outputTokens: 22, cachedInputTokens: 11 });
    const requestBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(requestBody.text.format.strict).toBe(true);
    expect(requestBody.store).toBe(false);
    expect(JSON.parse(requestBody.input[2].content)).not.toHaveProperty('candidates');
    // Real smoke on 2026-10-09 hit AI_TIMEOUT at ~45.0-45.1s on all 3 attempts — the
    // old 45000ms budget was consistently too tight for a real response, not a
    // one-off blip. Must stay comfortably below requestNutritionMealAlternative's
    // tighter 120s callable timeoutSeconds (functions/src/nutrition/generation/
    // mealAlternativeRequest.ts), which is the binding constraint shared by this
    // same provider — not the full-plan worker's much larger 540s budget.
    expect(OPENAI_REQUEST_TIMEOUT_MS).toBeGreaterThan(45_000);
    expect(OPENAI_REQUEST_TIMEOUT_MS).toBeLessThan(120_000 - 20_000);
    const invalid = new OpenAiNutritionProvider('test-secret', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(invalid.generatePlan({ profile, engine, goal, foodNames: noNames })).rejects.toThrow('AI_SCHEMA_INVALID');
    const failed = new OpenAiNutritionProvider('test-secret', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(failed.generatePlan({ profile, engine, goal, foodNames: noNames })).rejects.toThrow('AI_RATE_LIMIT');
    const timeout = new OpenAiNutritionProvider('test-secret', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
    await expect(timeout.generatePlan({ profile, engine, goal, foodNames: noNames })).rejects.toThrow('timeout');
    const refusalResponse = () => new Response(JSON.stringify({
      status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'cannot comply' }] }],
    }), { status: 200 });
    const refused = new OpenAiNutritionProvider('test-secret', vi.fn().mockImplementation(async () => refusalResponse()));
    await expect(generateValidatedPlan(refused, profile, engine, goal, noNames)).rejects.toMatchObject({
      code: 'AI_SAFETY_VALIDATION_FAILED',
    });
    // The model's own refusal reason is captured (bounded) and threaded
    // through to the attempt audit — the only way to diagnose a real
    // refusal pattern (round brief Fase 33, 2026-10-09) without ever
    // persisting prompt/output in Firestore (see worker.ts's onAttempt).
    const refused2 = new OpenAiNutritionProvider('test-secret', vi.fn().mockImplementation(async () => refusalResponse()));
    const audits: { code: string | null; refusalReason?: string }[] = [];
    await generateValidatedPlan(refused2, profile, engine, goal, noNames,
      async (audit) => { audits.push({ code: audit.code, refusalReason: audit.refusalReason }); })
      .catch(() => {});
    expect(audits[0]?.code).toBe('AI_SAFETY_VALIDATION_FAILED');
    expect(audits[0]?.refusalReason).toBe('cannot comply');
    const longRefusal = 'x'.repeat(500);
    const refusedLong = new OpenAiNutritionProvider('test-secret', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'completed', output: [{ content: [{ type: 'refusal', refusal: longRefusal }] }],
    }), { status: 200 })));
    await expect(refusedLong.generatePlan({ profile, engine, goal, foodNames: noNames })).rejects.toMatchObject({
      code: 'AI_SAFETY_VALIDATION_FAILED', refusalReason: 'x'.repeat(200),
    });
  });
});

describe('backend context and rollout parity', () => {
  it('uses prescribed, legacy, quiz and zero fallback, including flexible schedules', () => {
    expect(resolveBackendWorkoutFrequency({ prescribedTrainingFrequency: 4, prescribedStructuredDays: 3 }, 2)).toBe(4);
    expect(resolveBackendWorkoutFrequency({ prescribedStructuredDays: 3, scheduleMode: 'flexible' }, 2)).toBe(3);
    expect(resolveBackendWorkoutFrequency(null, 2)).toBe(2);
    expect(resolveBackendWorkoutFrequency(null, null)).toBe(0);
  });
  it('has a stable per-user rollout bucket', () => {
    expect(nutritionRolloutBucket('uid-1', 'nutritionEnabled')).toBe(nutritionRolloutBucket('uid-1', 'nutritionEnabled'));
  });
});

describe('resolveNutritionWeightKg — brand-new account with no assessment yet must not be blocked (2026-10-10 fix)', () => {
  it('a new account with only questionnaire.weight and no assessment is allowed to generate', () => {
    expect(resolveNutritionWeightKg(undefined, 70)).toEqual({ weightKg: 70, source: 'questionnaire' });
  });
  it('an existing assessment always wins over the questionnaire weight', () => {
    expect(resolveNutritionWeightKg(68, 70)).toEqual({ weightKg: 68, source: 'assessment' });
  });
  it('no questionnaire weight and no assessment stays blocked (resolves to a value the caller still rejects)', () => {
    expect(resolveNutritionWeightKg(undefined, undefined)).toEqual({ weightKg: undefined, source: 'questionnaire' });
  });
  it('an invalid weight (zero, negative, NaN, non-number) on either source never silently passes', () => {
    expect(resolveNutritionWeightKg(0, 70)).toEqual({ weightKg: 70, source: 'questionnaire' });
    expect(resolveNutritionWeightKg(-5, 70)).toEqual({ weightKg: 70, source: 'questionnaire' });
    expect(resolveNutritionWeightKg(NaN, 70)).toEqual({ weightKg: 70, source: 'questionnaire' });
    expect(resolveNutritionWeightKg('70', 70)).toEqual({ weightKg: 70, source: 'questionnaire' });
    // Both invalid — falls through to the questionnaire's (also invalid) value,
    // which `loadGenerationContext`'s existing validation still rejects downstream.
    expect(resolveNutritionWeightKg(null, 'not-a-number')).toEqual({ weightKg: 'not-a-number', source: 'questionnaire' });
    expect(resolveNutritionWeightKg(undefined, 0)).toEqual({ weightKg: 0, source: 'questionnaire' });
  });
});

describe('incident regression — rejected nutrient proportions', () => {
  it('confirms repair context in the outgoing payload while logging only presence flags', async () => {
    const info = vi.spyOn(backendLogger, 'logInfo').mockImplementation(() => {});
    try {
      const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
        status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(output()) }] }],
      }), { status: 200 }));
      const feedback = JSON.stringify({ failureCode: 'AI_MACRO_VALIDATION_FAILED', scope: 'meal',
        slot: 'breakfast', nutrients: ['proteinG:above_max'], previousPlan: output() });
      await new OpenAiNutritionProvider('test-key', fetcher).generatePlan({ profile, engine, goal,
        foodNames: noNames, feedback, trace: { generationId: 'job-repair', attempt: 2 } });
      const payload = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(JSON.parse(payload.input[2].content).retryFeedback).toBe(feedback);
      expect(info).toHaveBeenCalledWith('nutrition.generation', 'ai_request_started', expect.objectContaining({
        generationId: 'job-repair', attempt: 2, retryFeedbackPresent: true, repairCandidatePresent: true,
      }));
      expect(JSON.stringify(info.mock.calls)).not.toContain('Mingau');
    } finally { info.mockRestore(); }
  });
  it('preserves rejection and repairs the rejected candidate while keeping audit diagnostics free of food content', async () => {
    const wrong = output();
    wrong.meals[0].foods[0].estimatedNutrition.proteinG = 40;
    wrong.meals[0].foods[0].estimatedNutrition.fiberG = 1;
    const provider = fakeProvider(wrong, output());
    const audits: unknown[] = [];
    const generated = await generateValidatedPlan(provider, profile, engine, goal, noNames,
      async (audit) => { audits.push(audit.validationIssue); }, async () => {}, { generationId: 'diagnostic-job' });
    expect(generated.attempt).toBe(2);
    expect(audits[0]).toEqual({ scope: 'meal', slot: 'breakfast',
      nutrients: ['proteinG:above_max', 'fiberG:below_min'] });
    const retry = vi.mocked(provider.generatePlan).mock.calls[1][0];
    expect(JSON.parse(retry.feedback!)).toEqual({ failureCode: 'AI_MACRO_VALIDATION_FAILED',
      scope: 'meal', slot: 'breakfast', nutrients: ['proteinG:above_max', 'fiberG:below_min'], previousPlan: wrong });
    expect(JSON.stringify(audits)).not.toContain('Mingau');
    expect(retry.trace).toEqual({ generationId: 'diagnostic-job', attempt: 2 });
    expect(() => validateAndBuildPlan(wrong, profile.mealSlots, engine)).toThrow('meal_target_deviation');
  });

  it.each([400, 401, 403, 404, 429, 500])('classifies HTTP %s and retries only transient provider responses', async (httpStatus) => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ error: { code: httpStatus === 429 ? 'rate_limit_exceeded' : 'provider_failure',
        message: 'private body must never be logged' } }), { status: httpStatus }));
    const provider = new OpenAiNutritionProvider('private-key', fetcher);
    const audits: unknown[] = [];
    await expect(generateValidatedPlan(provider, profile, engine, goal, noNames,
      async (audit) => { audits.push(audit); })).rejects.toMatchObject({
      code: httpStatus === 429 ? 'AI_RATE_LIMIT' : 'AI_PROVIDER_ERROR',
    });
    expect(fetcher).toHaveBeenCalledTimes(httpStatus === 429 || httpStatus >= 500 ? 3 : 1);
    expect(audits).toHaveLength(fetcher.mock.calls.length);
  });

  it('does not retry insufficient_quota even though the HTTP status is 429', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 }));
    await expect(generateValidatedPlan(new OpenAiNutritionProvider('key', fetcher), profile, engine, goal, noNames))
      .rejects.toMatchObject({ code: 'AI_RATE_LIMIT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('dietary restrictions across generation, regeneration and meal alternatives', () => {
  function composed(name: string, origin: import('../generation/domain').RawAiFoodItem['ingredients'][number]['origin']) {
    return { ...item(name, 400, 20, 50, 10, 10), ingredients: [{ name, origin }] };
  }
  function plantPlan() {
    const plan = output();
    plan.meals[1].foods[0].name = 'Arroz com feijão';
    plan.meals[1].foods[0].ingredients = [{ name: 'Arroz', origin: 'plant' }, { name: 'Feijão', origin: 'plant' }];
    return plan;
  }
  it.each(['omnivore', 'vegetarian', 'vegan', 'pescatarian'] as const)('accepts compatible meals for %s on repeated generations', async (dietaryPattern) => {
    const generatePlan = fakeProvider(plantPlan(), plantPlan());
    for (let i = 0; i < 2; i++) {
      expect((await generateValidatedPlan(generatePlan, { ...profile, dietaryPattern }, engine, goal, noNames)).attempt).toBe(1);
    }
    const request = vi.mocked(generatePlan.generatePlan).mock.calls[0][0];
    expect(request.profile).not.toHaveProperty('pregnant');
    expect(request.profile).not.toHaveProperty('breastfeeding');
  });
  it.each([
    ['vegetarian', 'Frango', 'terrestrial_animal'], ['vegetarian', 'Tilápia', 'fish'],
    ['vegetarian', 'Camarão', 'shellfish'], ['vegan', 'Iogurte', 'dairy'], ['vegan', 'Ovo', 'egg'],
    ['vegan', 'Whey', 'dairy'], ['vegan', 'Mel', 'other_animal'], ['pescatarian', 'Carne bovina', 'terrestrial_animal'],
    ['pescatarian', 'Caldo sem composição conhecida', 'unknown'], ['vegan', 'Queijo', 'plant'],
  ] as const)('blocks %s with %s even when allergens are omitted', async (dietaryPattern, name, origin) => {
    const plan = plantPlan();
    plan.meals[0].foods[0] = composed(name, origin) as ReturnType<typeof item>;
    const provider = fakeProvider(plan);
    await expect(generateValidatedPlan(provider, { ...profile, dietaryPattern }, engine, goal, noNames))
      .rejects.toMatchObject({ code: 'AI_SAFETY_VALIDATION_FAILED' });
    expect(provider.generatePlan).toHaveBeenCalledTimes(1);
  });
  it('allows lacto-ovo vegetarian meals and seafood for pescatarians', () => {
    for (const [dietaryPattern, name, origin] of [
      ['vegetarian', 'Iogurte', 'dairy'], ['vegetarian', 'Ovo', 'egg'], ['pescatarian', 'Tilápia', 'fish'],
      ['pescatarian', 'Camarão', 'shellfish'], ['vegan', 'Leite de coco', 'plant'], ['vegan', 'Carne de soja', 'plant'],
    ] as const) {
      const plan = plantPlan();
      plan.meals[0].foods[0] = composed(name, origin) as ReturnType<typeof item>;
      expect(() => validateAndBuildPlan(plan, profile.mealSlots, engine, [], true, { dietaryPattern, excludedFoodNames: [] })).not.toThrow();
    }
  });
  it('combines hard ingredient exclusions, allergies and dietary pattern, overriding preferred foods', async () => {
    const plan = plantPlan();
    const names = { preferred: ['Feijão'], usual: [], excluded: ['Feijão, cozido'] };
    await expect(generateValidatedPlan(fakeProvider(plan), { ...profile, dietaryPattern: 'vegan' }, engine, goal, names))
      .rejects.toMatchObject({ code: 'AI_SAFETY_VALIDATION_FAILED' });
    plan.meals[0].foods[0] = composed('Leite de soja', 'plant') as ReturnType<typeof item>;
    await expect(generateValidatedPlan(fakeProvider(plan), { ...profile, dietaryPattern: 'vegan', excludedAllergens: ['soy'] }, engine, goal, noNames))
      .rejects.toMatchObject({ code: 'AI_SAFETY_VALIDATION_FAILED' });
  });
  it('fails closed on missing composition metadata', () => {
    const plan = output();
    delete (plan.meals[0].foods[0] as Partial<ReturnType<typeof item>>).ingredients;
    expect(() => validateAndBuildPlan(plan, profile.mealSlots, engine)).toThrow('invalid_schema');
  });
  it('keeps legacy safety state out of both HTTP AI contexts', () => {
    for (const payload of [fullPlanContext(profile, engine, goal, noNames),
      mealAlternativeContext(profile, engine.mealTargets[0], [], goal, noNames)]) {
      expect(JSON.parse(payload)).not.toHaveProperty('pregnant');
      expect(JSON.parse(payload)).not.toHaveProperty('breastfeeding');
    }
  });
});
