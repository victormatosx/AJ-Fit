import { describe, expect, it } from 'vitest';
import type { MealNutritionTarget, NutritionTotals } from '../shared/types/nutrition';
import type { RawAiFoodItem } from '../generation/domain';
import { admissibleScale } from '../generation/correction';
import { optimizePortions } from '../generation/portionOptimizer';
import { validateAndBuildPlan } from '../generation/domain';
import { NUTRIENTS } from '../generation/diagnostics';
import { macroEngine, macroProfile } from './fixtures/macroCorrection';

function food(name: string, quantity: number, unit: string, per: NutritionTotals): RawAiFoodItem {
  return { name, quantity, unit, preparationNote: '', allergens: [],
    ingredients: [{ name, origin: 'plant' }], estimatedNutrition: { ...per } };
}
function totals(items: readonly RawAiFoodItem[]): NutritionTotals {
  const sum = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
  for (const item of items) for (const nutrient of NUTRIENTS) sum[nutrient] += item.estimatedNutrition[nutrient];
  return sum;
}
const range = (target: number, tolerance: number): { min: number; target: number; max: number } =>
  ({ min: target * (1 - tolerance), target, max: target * (1 + tolerance) });
// Rice, chicken, olive oil, beans — a realistic 4-item meal where fat is low but
// kcal/protein/carb/fiber already match target. Oil contributes fat only, so it is
// the one item whose multiplier can move fat without disturbing anything else —
// exactly the case a single uniform factor can never solve (moving it necessarily
// drags every other nutrient along, by the same proportion).
function fatDeficientMeal(): RawAiFoodItem[] {
  return [
    food('Arroz', 150, 'g', { kcal: 300, proteinG: 6, carbsG: 66, fatG: 1.5, fiberG: 3 }),
    food('Frango', 120, 'g', { kcal: 198, proteinG: 37.2, carbsG: 0, fatG: 4.32, fiberG: 0 }),
    food('Azeite', 5, 'g', { kcal: 44.2, proteinG: 0, carbsG: 0, fatG: 5, fiberG: 0 }),
    food('Feijão', 80, 'g', { kcal: 101.6, proteinG: 7.2, carbsG: 18.4, fatG: 0.4, fiberG: 4.8 }),
  ];
}
function fatDeficientTarget(): MealNutritionTarget {
  const base = totals(fatDeficientMeal());
  // Protein/carb windows use the product's own real tolerance (10%) — still far tighter than
  // what any single uniform factor could preserve while also raising fat, but not an
  // artificially-absolute-gram window that leaves no numerical slack for anything else.
  return { slot: 'lunch', kcal: range(base.kcal, 0.05), proteinG: range(base.proteinG, 0.1),
    carbsG: range(base.carbsG, 0.1), fatG: { min: 14, target: 16, max: 18 }, fiberG: range(base.fiberG, 0.1) };
}

describe('optimizePortions — per-item deterministic portion adjustment', () => {
  it('raises fat by moving only the fat-dense item, leaving protein/carb/fiber untouched — infeasible for any single uniform factor', () => {
    const items = fatDeficientMeal();
    const target = fatDeficientTarget();
    const baseline = totals(items);
    // 1. Prove the existing uniform-scale corrector genuinely cannot do this.
    expect(admissibleScale(baseline, target).interval).toBeNull();
    // 2. The per-item optimizer can.
    const result = optimizePortions(items, target);
    expect(result.reason).toBeNull();
    expect(result.items).not.toBeNull();
    const final = totals(result.items!);
    expect(final.fatG).toBeGreaterThanOrEqual(target.fatG!.min - 0.01);
    expect(final.fatG).toBeLessThanOrEqual(target.fatG!.max + 0.01);
    expect(final.proteinG).toBeGreaterThanOrEqual(target.proteinG!.min - 0.01);
    expect(final.proteinG).toBeLessThanOrEqual(target.proteinG!.max + 0.01);
    expect(final.carbsG).toBeGreaterThanOrEqual(target.carbsG!.min - 0.01);
    expect(final.carbsG).toBeLessThanOrEqual(target.carbsG!.max + 0.01);
    expect(final.fiberG).toBeGreaterThanOrEqual(target.fiberG!.min - 0.01);
    expect(final.fiberG).toBeLessThanOrEqual(target.fiberG!.max + 0.01);
    // 3. Only the oil item actually moved; rice/chicken/beans multipliers stayed ~1.
    const multipliers = result.multipliers!;
    expect(Math.abs(multipliers[2] - 1)).toBeGreaterThan(0.1);
    expect(Math.abs(multipliers[0] - 1)).toBeLessThan(0.15);
    expect(Math.abs(multipliers[1] - 1)).toBeLessThan(0.15);
    expect(Math.abs(multipliers[3] - 1)).toBeLessThan(0.15);
    // 4. Never fabricates nutrients: every item's nutrition still scales linearly off its own original per-quantity values.
    for (let i = 0; i < items.length; i++) for (const nutrient of NUTRIENTS) {
      const ratio = result.items![i].quantity / items[i].quantity;
      expect(result.items![i].estimatedNutrition[nutrient]).toBeCloseTo(items[i].estimatedNutrition[nutrient] * ratio, 6);
    }
  });

  it('wires into validateAndBuildPlan end-to-end and is reported as the per_item method', () => {
    const plan = { meals: [{ slot: 'breakfast' as const, foods: fatDeficientMeal() },
      { slot: 'lunch' as const, foods: fatDeficientMeal() }] };
    const engine = structuredClone(macroEngine);
    engine.mealTargets = [fatDeficientTarget(), fatDeficientTarget()];
    engine.mealTargets[0].slot = 'breakfast'; engine.mealTargets[1].slot = 'lunch';
    const base = totals(fatDeficientMeal());
    engine.energy.targetKcal = base.kcal * 2;
    engine.macros = { proteinG: base.proteinG * 2, carbsG: base.carbsG * 2, fatG: 16 * 2, fiberG: base.fiberG * 2 };
    const result = validateAndBuildPlan(plan, macroProfile.mealSlots, engine);
    expect(result.corrected).toBe(true);
    expect(result.diagnostics.meals[0].correction.method).toBe('per_item');
    expect(result.diagnostics.daily.status).toBe('passed');
  });

  it('a single food has no per-item freedom and defers to the uniform corrector instead', () => {
    const items = [food('Arroz', 150, 'g', { kcal: 300, proteinG: 6, carbsG: 66, fatG: 1.5, fiberG: 3 })];
    const target = fatDeficientTarget();
    const result = optimizePortions(items, target);
    expect(result.items).toBeNull();
    expect(result.reason).toBe('optimizer_infeasible');
  });

  it('refuses an ambiguous unit rather than guessing a rounding step', () => {
    const items = [...fatDeficientMeal().slice(0, 2), food('Suplemento', 1, 'pacote especial', { kcal: 50, proteinG: 0, carbsG: 0, fatG: 10, fiberG: 0 })];
    const result = optimizePortions(items, fatDeficientTarget());
    expect(result.items).toBeNull();
    expect(result.reason).toBe('ambiguous_unit');
  });

  it('reports zero_nutrient when every item has zero of a required nutrient, instead of claiming a false optimum', () => {
    const items = fatDeficientMeal().map((item) => ({ ...item, estimatedNutrition: { ...item.estimatedNutrition, fiberG: 0 } }));
    const target = fatDeficientTarget();
    target.fiberG = { min: 5, target: 8, max: 10 };
    const result = optimizePortions(items, target);
    expect(result.items).toBeNull();
    expect(result.reason).toBe('zero_nutrient');
  });

  it('declares optimizer_infeasible, never a partial fabricated fit, when the target is mathematically out of reach within [0.5, 2]', () => {
    const items = fatDeficientMeal();
    const target = fatDeficientTarget();
    // Fat would need to roughly quadruple beyond what any item's [0.5,2] multiplier allows.
    target.fatG = { min: 60, target: 65, max: 70 };
    const result = optimizePortions(items, target);
    expect(result.items).toBeNull();
    expect(result.reason).toBe('optimizer_infeasible');
  });

  it('leaves an already-on-target meal effectively unchanged (no unnecessary portion churn)', () => {
    const items = fatDeficientMeal();
    const baseline = totals(items);
    const target: MealNutritionTarget = { slot: 'lunch', kcal: range(baseline.kcal, 0.05), proteinG: range(baseline.proteinG, 0.1),
      carbsG: range(baseline.carbsG, 0.1), fatG: range(baseline.fatG, 0.1), fiberG: range(baseline.fiberG, 0.1) };
    const result = optimizePortions(items, target);
    expect(result.items).not.toBeNull();
    for (const multiplier of result.multipliers!) expect(Math.abs(multiplier - 1)).toBeLessThan(0.05);
  });

  it('respects indivisible unit counts — a capsule/unit item is only ever adjusted to a whole number', () => {
    const items = [
      food('Arroz', 150, 'g', { kcal: 300, proteinG: 6, carbsG: 66, fatG: 1.5, fiberG: 3 }),
      food('Cápsula de óleo de peixe', 2, 'capsula', { kcal: 18, proteinG: 0, carbsG: 0, fatG: 2, fiberG: 0 }),
    ];
    const baseline = totals(items);
    const target: MealNutritionTarget = { slot: 'lunch', kcal: range(baseline.kcal, 0.08), proteinG: range(baseline.proteinG, 0.3),
      carbsG: range(baseline.carbsG, 0.3), fatG: { min: 5, target: 6, max: 7 }, fiberG: { min: 0, target: 0, max: 10 } };
    const result = optimizePortions(items, target);
    if (result.items) expect(Number.isInteger(result.items[1].quantity)).toBe(true);
    else expect(result.reason).not.toBeNull();
  });

  it('every produced quantity stays within (0, 5000] and passes the ordinary item validator', () => {
    const items = fatDeficientMeal();
    const result = optimizePortions(items, fatDeficientTarget());
    for (const item of result.items ?? []) {
      expect(item.quantity).toBeGreaterThan(0);
      expect(item.quantity).toBeLessThanOrEqual(5000);
    }
  });

  it('is deterministic — identical inputs always produce identical multipliers (no RNG, no solver nondeterminism)', () => {
    const a = optimizePortions(fatDeficientMeal(), fatDeficientTarget());
    const b = optimizePortions(fatDeficientMeal(), fatDeficientTarget());
    expect(a.multipliers).toEqual(b.multipliers);
    expect(a.items).toEqual(b.items);
  });

  it('never adds or removes a food item — same names/ingredients/allergens in, same set out', () => {
    const items = fatDeficientMeal();
    const result = optimizePortions(items, fatDeficientTarget());
    expect(result.items!.map((item) => item.name)).toEqual(items.map((item) => item.name));
    expect(result.items!.map((item) => item.ingredients)).toEqual(items.map((item) => item.ingredients));
    expect(result.items!.map((item) => item.allergens)).toEqual(items.map((item) => item.allergens));
  });
});
