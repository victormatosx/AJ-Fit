import { describe, expect, it, vi } from 'vitest';
import * as logger from '../../lib/logger';
import { generateValidatedPlan } from '../generation/attempts';
import { generateValidatedMealAlternative } from '../generation/alternative';
import { PlanValidationError, parseAiOutput, validateAndBuildPlan, validateAndBuildMealAlternative,
  type RawAiFoodItem } from '../generation/domain';
import { admissibleScale, scaledPortions } from '../generation/correction';
import { logValidationDiagnostics, NUTRIENTS } from '../generation/diagnostics';
import { macroCases, macroDaily, macroEngine, macroFood, macroPlan, macroProfile } from './fixtures/macroCorrection';

const names = { preferred: [], usual: [], excluded: [] };
const validate = (plan = macroPlan(), engine = macroEngine, correction = true) =>
  validateAndBuildPlan(plan, macroProfile.mealSlots, engine, [], correction);
function validationError(run: () => unknown): PlanValidationError {
  try { run(); } catch (error) { expect(error).toBeInstanceOf(PlanValidationError); return error as PlanValidationError; }
  throw new Error('Expected rejection');
}
function providerFor(...outputs: unknown[]) {
  const generatePlan = vi.fn().mockImplementation(async () => ({ output: outputs.shift(), model: 'synthetic',
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, latencyMs: 0 }));
  return { generatePlan };
}

describe('P1 admissible proportional correction', () => {
  it('recovers the 500 kcal / 28 g protein incident without changing targets or valid meals', () => {
    const plan = macroCases()[2].plan;
    const snapshot = structuredClone(plan);
    const engine = structuredClone(macroEngine);
    const result = validate(plan);
    expect(result.corrected).toBe(true);
    expect(result.meals[0].options[0].totals.proteinG).toBeLessThanOrEqual(27.51);
    expect(result.meals[0].options[0].totals.kcal).toBeGreaterThanOrEqual(474.99);
    expect(result.meals[1].options[0].foods[0].quantity).toBe(100);
    expect(result.diagnostics.daily.status).toBe('passed');
    expect(plan).toEqual(snapshot);
    expect(macroEngine).toEqual(engine);
  });

  it('keeps an already valid candidate byte-for-byte unchanged at item level', () => {
    const plan = macroPlan();
    const result = validate(plan);
    expect(result.corrected).toBe(false);
    expect(result.dailyTotals).toEqual(macroDaily);
    for (let i = 0; i < 2; i++) {
      const { ingredients: _ingredients, ...persisted } = plan.meals[i].foods[0];
      expect(result.meals[i].options[0].foods[0]).toEqual(persisted);
    }
  });

  it.each(['impossible_intersection', 'zero_protein'])('rejects %s with a finite structured diagnostic', (name) => {
    const fixture = macroCases().find((entry) => entry.name === name)!;
    const error = validationError(() => validate(fixture.plan));
    expect(error.code).toBe('AI_MACRO_VALIDATION_FAILED');
    expect(error.diagnostics?.meals[0].correction).toMatchObject({ attempted: true, status: 'rejected', interval: null,
      reason: name === 'zero_protein' ? 'zero_nutrient' : 'empty_intersection' });
    expect(JSON.stringify(error.diagnostics)).not.toMatch(/NaN|Infinity/);
  });

  it('handles allowed zero nutrients and zero-width inclusive intervals without division by zero', () => {
    const target = structuredClone(macroEngine.mealTargets[0]);
    target.fiberG = { min: 0, target: 0, max: 0 };
    const total = { ...macroFood().estimatedNutrition, fiberG: 0 };
    expect(admissibleScale(total, target).interval).not.toBeNull();
    // The +/-0.01 margins make these two constraints meet at exactly factor 1.
    target.kcal = { min: 500.01, target: 500.01, max: 600 };
    target.proteinG = { min: 0, target: 24.99, max: 24.99 };
    expect(admissibleScale(total, target).interval).toEqual({ min: 1, max: 1 });
  });

  it.each([-1, 1])('preserves inclusive nutrient bounds and 0.01 margins (direction %s)', (direction) => {
    const plan = macroPlan();
    for (const meal of plan.meals) for (const key of NUTRIENTS) {
      const range = macroEngine.mealTargets[0][key]!;
      meal.foods[0].estimatedNutrition[key] = direction < 0 ? range.min : range.max;
    }
    expect(validate(plan, macroEngine, false).corrected).toBe(false);
    plan.meals[0].foods[0].estimatedNutrition.kcal = direction < 0 ? 474.99 : 525.01;
    expect(validate(plan, macroEngine, false).corrected).toBe(false);
    plan.meals[0].foods[0].estimatedNutrition.kcal = direction < 0 ? 474.98 : 525.02;
    expect(validationError(() => validate(plan, macroEngine, false)).issue?.scope).toBe('meal');
  });

  it('never approves locally corrected meals when the complete day is invalid', () => {
    const engine = structuredClone(macroEngine);
    engine.energy.targetKcal = 1300;
    const plan = macroPlan();
    plan.meals.forEach((meal) => { meal.foods = [macroFood(0.5)]; });
    const error = validationError(() => validate(plan, engine));
    expect(error.issue?.scope).toBe('daily');
    expect(error.diagnostics?.meals.every((meal) => meal.correction.status === 'applied')).toBe(true);
    expect(error.diagnostics?.daily).toMatchObject({ status: 'failed', deviations: [{ nutrient: 'kcal', direction: 'below_min' }] });
  });

  it('does not accept accumulated per-meal rounding margins at the daily boundary', () => {
    const plan = macroPlan(); plan.meals.forEach((meal) => { meal.foods[0].estimatedNutrition.kcal = 525.01; });
    expect(validationError(() => validate(plan)).issue).toEqual({ scope: 'daily', nutrients: ['kcal:above_max'] });
  });
});

describe('P1 representable portions', () => {
  it.each(['rounds_to_zero', 'quantity_over_max', 'discrete_unrepresentable', 'ambiguous_unit'])(
    'rejects %s instead of persisting an unsafe or invented portion', (name) => {
      const fixture = macroCases().find((entry) => entry.name === name)!;
      const error = validationError(() => validate(fixture.plan));
      expect(error.code).toBe('AI_MACRO_VALIDATION_FAILED');
      expect(error.diagnostics?.meals[0].correction.status).toBe('rejected');
      expect(error.diagnostics?.meals[0].correction.reason).toBe(name === 'ambiguous_unit' ? 'ambiguous_unit'
        : name === 'discrete_unrepresentable' ? 'quantized_out_of_range' : 'invalid_portion');
    });

  it('allows integer count corrections only when their actual nutrients fit', () => {
    const plan = macroPlan(); plan.meals[0].foods = [{ ...macroFood(0.5), quantity: 1, unit: 'unidade' }];
    const result = validate(plan);
    const item = result.meals[0].options[0].foods[0];
    expect(item.quantity).toBe(2);
    expect(item.unit).toBe('unidade');
    expect(item.estimatedNutrition).toEqual(macroFood().estimatedNutrition);
    plan.meals[0].foods[0].quantity = 0.5;
    expect(validationError(() => validate(plan)).code).toBe('AI_SCHEMA_INVALID');
  });

  it('computes every nutrient from the final quantity ratio, including mixed units', () => {
    const items: RawAiFoodItem[] = [{ ...macroFood(), quantity: 73.333 }, { ...macroFood(), quantity: 1, unit: 'unidade' }];
    const scaled = scaledPortions(items, 0.98123).items!;
    for (let i = 0; i < items.length; i++) for (const nutrient of NUTRIENTS) {
      expect(scaled[i].estimatedNutrition[nutrient]).toBe(items[i].estimatedNutrition[nutrient] * (scaled[i].quantity / items[i].quantity));
    }
    expect(scaled[0].quantity).toBe(71.96);
    expect(scaled[1].quantity).toBe(1);
  });

  it('revalidates item bounds after scaling, not just quantities and meal totals', () => {
    const plan = macroPlan();
    const engine = structuredClone(macroEngine);
    plan.meals[0].foods[0].estimatedNutrition.kcal = 60000;
    for (const nutrient of NUTRIENTS) {
      const range = engine.mealTargets[0][nutrient]!;
      engine.mealTargets[0][nutrient] = { min: range.min * 2, target: range.target * 2, max: range.max * 2 };
    }
    engine.mealTargets[0].kcal = { min: 114000, target: 120000, max: 126000 };
    expect(validationError(() => validate(plan, engine)).diagnostics?.meals[0].correction.reason).toBe('invalid_portion');
  });
});

describe('P1 safety precedence, diagnostics and bounded retries', () => {
  it.each(['later_allergy', 'later_exclusion', 'later_diet'])('stops %s before a macro retry', async (name) => {
    const fixture = macroCases().find((entry) => entry.name === name)!;
    const provider = providerFor(fixture.plan, macroPlan());
    await expect(generateValidatedPlan(provider, { ...macroProfile, excludedAllergens: fixture.allergens,
      dietaryPattern: fixture.restrictions?.dietaryPattern ?? 'omnivore' }, macroEngine, 'health',
    { ...names, excluded: fixture.restrictions ? [...fixture.restrictions.excludedFoodNames] : [] })).rejects.toMatchObject({ code: 'AI_SAFETY_VALIDATION_FAILED' });
    expect(provider.generatePlan).toHaveBeenCalledTimes(1);
  });

  it('checks every alternative option for safety before its first macro failure', () => {
    const wrong = macroFood(); wrong.estimatedNutrition.proteinG = 100;
    const unsafe = macroFood(); unsafe.allergens = ['milk'];
    expect(validationError(() => validateAndBuildMealAlternative({ recommendedOptionIndex: 0,
      options: [{ foods: [wrong] }, { foods: [unsafe] }] }, 'breakfast', macroEngine.mealTargets[0], ['milk'])).code).toBe('AI_SAFETY_VALIDATION_FAILED');
  });

  it('successful deterministic correction consumes exactly one simulated provider call', async () => {
    const provider = providerFor(macroCases()[2].plan);
    expect((await generateValidatedPlan(provider, macroProfile, macroEngine, 'health', names)).validated.corrected).toBe(true);
    expect(provider.generatePlan).toHaveBeenCalledTimes(1);
  });

  it('reports all meal and daily deviations numerically and never logs the rejected candidate', async () => {
    const plan = macroPlan();
    plan.meals[0].foods[0].estimatedNutrition.proteinG = 100;
    plan.meals[1].foods[0].estimatedNutrition.fiberG = 0;
    const provider = providerFor(plan, macroPlan());
    const info = vi.spyOn(logger, 'logInfo').mockImplementation(() => {});
    try {
      const result = await generateValidatedPlan(provider, macroProfile, macroEngine, 'health', names, async (audit) => {
        logValidationDiagnostics(audit.validationDiagnostics, { generationId: 'synthetic', attempt: audit.attempt });
      });
      expect(result.attempt).toBe(2);
      const feedback = JSON.parse(provider.generatePlan.mock.calls[1][0].feedback);
      expect(feedback.validation.meals.filter((meal: { status: string }) => meal.status === 'failed')).toHaveLength(2);
      expect(feedback.validation.meals[0].deviations[0]).toEqual({ nutrient: 'proteinG', observed: 100,
        min: 22.5, max: 27.5, direction: 'above_max', absolute: 72.5, percent: 263.636364 });
      expect(feedback.validation.daily.status).toBe('failed');
      expect(feedback.previousPlan).toEqual(plan);
      expect(feedback.instruction).toContain('truthful portions');
      expect(JSON.stringify(info.mock.calls)).not.toContain('Alimento');
      expect(JSON.stringify(info.mock.calls)).not.toContain('Ingrediente');
      expect(JSON.stringify(info.mock.calls)).not.toContain('previousPlan');
      expect(info).toHaveBeenCalledWith('nutrition.generation', 'nutrient_deviation', expect.objectContaining({ observed: 100, min: 22.5 }));
      // Numeric diagnostics for this two-failure fixture add <3 KB, not another plan copy.
      expect(provider.generatePlan.mock.calls[1][0].feedback.length - JSON.stringify(plan).length).toBeLessThan(3000);
    } finally { info.mockRestore(); }
  });

  it('preserves fallback on attempt three and never calls a fourth time on exhaustion', async () => {
    const bad = macroCases().find((entry) => entry.name === 'impossible_intersection')!.plan;
    const recovered = providerFor(bad, bad, macroPlan());
    expect((await generateValidatedPlan(recovered, macroProfile, macroEngine, 'health', names)).fallback).toBe(true);
    expect(recovered.generatePlan.mock.calls.map((call) => call[0].fallback)).toEqual([false, false, true]);
    const exhausted = providerFor(bad, bad, bad, macroPlan());
    await expect(generateValidatedPlan(exhausted, macroProfile, macroEngine, 'health', names)).rejects.toMatchObject({ code: 'AI_MACRO_VALIDATION_FAILED' });
    expect(exhausted.generatePlan).toHaveBeenCalledTimes(3);
  });

  it('provides numeric retry diagnostics for alternatives without changing their attempt budget', async () => {
    const bad = { recommendedOptionIndex: 0, options: [{ foods: [macroFood()] }, { foods: [macroFood()] }] };
    bad.options[0].foods[0].estimatedNutrition.proteinG = 100;
    const good = { recommendedOptionIndex: 0, options: [{ foods: [macroFood()] }, { foods: [macroFood()] }] };
    const generateMealAlternative = vi.fn().mockResolvedValueOnce({ output: bad }).mockResolvedValue({ output: good });
    const result = await generateValidatedMealAlternative({ generatePlan: vi.fn(), generateMealAlternative }, macroProfile,
      'breakfast', macroEngine.mealTargets[0], [], 'health', names, undefined);
    expect(result.attempt).toBe(2);
    expect(JSON.parse(generateMealAlternative.mock.calls[1][0].feedback).validation.daily.status).toBe('not_applicable');
  });

  it('sends locally repaired meals in retry context without re-reporting their original deviations', async () => {
    const plan = macroPlan();
    plan.meals[0].foods[0].estimatedNutrition.proteinG = 28;
    plan.meals[1].foods[0].estimatedNutrition.fiberG = 0;
    const provider = providerFor(plan, macroPlan());
    await generateValidatedPlan(provider, macroProfile, macroEngine, 'health', names);
    const feedback = JSON.parse(provider.generatePlan.mock.calls[1][0].feedback);
    expect(feedback.validation.meals).toHaveLength(1);
    expect(feedback.validation.meals[0].slot).toBe('lunch');
    expect(feedback.previousPlan.meals[0].foods[0].quantity).toBeLessThan(100);
    expect(feedback.previousPlan.meals[0].foods[0].estimatedNutrition.proteinG).toBeLessThanOrEqual(27.51);
    expect(feedback.previousPlan.meals[0].foods[0].ingredients).toEqual(plan.meals[0].foods[0].ingredients);
    // Feedback must not quantize the original/corrected food values again.
    expect(feedback.previousPlan.meals[0].foods[0].estimatedNutrition.proteinG).toBe(
      28 * (feedback.previousPlan.meals[0].foods[0].quantity / 100));
  });
});

it('preserves validation invariants over 400 deterministic varied synthetic samples', () => {
  let approved = 0; let rejected = 0;
  for (let sample = 0; sample < 400; sample++) {
    const plan = macroPlan();
    for (let i = 0; i < plan.meals.length; i++) {
      const item = macroFood(0.4 + ((sample * 17 + i * 11) % 160) / 100);
      item.quantity = 20 + sample % 101;
      if (sample % 7 === 0) item.unit = 'unidade';
      if (sample % 11 === 0) item.estimatedNutrition.proteinG *= 2;
      if (sample % 13 === 0) item.estimatedNutrition.fiberG = 0;
      if (sample % 17 === 0) item.allergens = ['milk'];
      if (sample % 19 === 0) item.name = 'Alimento proibido';
      if (sample % 23 === 0) item.ingredients[0].origin = 'dairy';
      plan.meals[i].foods = [item];
    }
    const before = structuredClone(plan);
    let result: ReturnType<typeof validateAndBuildPlan>;
    try {
      result = validateAndBuildPlan(plan, macroProfile.mealSlots, macroEngine, ['milk'], true,
        { dietaryPattern: 'vegan', excludedFoodNames: ['Alimento proibido'] });
    } catch (error) {
      if (!(error instanceof PlanValidationError)) throw error;
      rejected++;
      expect(plan).toEqual(before);
      continue;
    }
    approved++;
    expect(sample % 17).not.toBe(0); expect(sample % 19).not.toBe(0); expect(sample % 23).not.toBe(0);
    expect(result.diagnostics.daily.status).toBe('passed');
    for (let i = 0; i < result.meals.length; i++) {
      const option = result.meals[i].options[0];
      for (const nutrient of NUTRIENTS) {
        expect(option.totals[nutrient]).toBeGreaterThanOrEqual(macroEngine.mealTargets[i][nutrient]!.min - 0.01);
        expect(option.totals[nutrient]).toBeLessThanOrEqual(macroEngine.mealTargets[i][nutrient]!.max + 0.01);
      }
      for (const item of option.foods) {
        expect(item.quantity).toBeGreaterThan(0); expect(item.quantity).toBeLessThanOrEqual(5000);
        if (item.unit === 'unidade') expect(Number.isInteger(item.quantity)).toBe(true);
        for (const nutrient of NUTRIENTS) expect(item.estimatedNutrition![nutrient]).toBeCloseTo(
          before.meals[i].foods[0].estimatedNutrition[nutrient] * item.quantity / before.meals[i].foods[0].quantity, 8);
      }
    }
    const tolerances = { kcal: 0.05, proteinG: 0.10, carbsG: 0.10, fatG: 0.10, fiberG: 0.20 };
    for (const nutrient of NUTRIENTS) {
      expect(Math.abs(result.dailyTotals[nutrient] - macroDaily[nutrient])).toBeLessThanOrEqual(
        macroDaily[nutrient] * tolerances[nutrient] + 0.01);
    }
    const rebuilt = { meals: result.meals.map((meal, index) => ({ slot: meal.slot,
      foods: meal.options[0].foods.map((item) => ({ ...item, ingredients: before.meals[index].foods[0].ingredients })) })) };
    parseAiOutput(rebuilt);
    expect(validateAndBuildPlan(rebuilt, macroProfile.mealSlots, macroEngine, ['milk'], false).dailyTotals).toEqual(result.dailyTotals);
    expect(plan).toEqual(before);
  }
  expect(approved).toBeGreaterThan(100);
  expect(rejected).toBeGreaterThan(100);
  console.info(JSON.stringify({ invariantSamples: 400, approved, rejected }));
});
