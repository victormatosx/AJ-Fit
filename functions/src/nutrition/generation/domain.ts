import { foodRestrictionViolation } from './restrictions';
import {
  NUTRITION_FOOD_ALLERGENS,
  type NutritionFoodNutritionValues, type NutritionMeal, type NutritionMealOption,
  type NutritionMealSlot, type NutritionEngineOutput, type MealNutritionTarget,
  type DietaryPattern, type NutritionTotals, type NutritionFoodAllergen, NUTRITION_MEAL_SLOTS,
} from '../shared/types/nutrition';
import { roundNutritionValues, sumNutritionValues, validateNutritionValues } from '../shared/nutrition/catalog/math';
import { TOLERANCE_PERCENT } from '../shared/nutrition/engine/constants';

/** Free-form AI meals require composition metadata and pass dietary, exclusion,
 * allergen and macro validation before persistence. Catalog IDs are not generated. */
export type FailureCode = 'AI_SCHEMA_INVALID' | 'AI_SAFETY_VALIDATION_FAILED' | 'AI_MACRO_VALIDATION_FAILED';
export interface ValidationIssue {
  scope: 'meal' | 'daily';
  slot?: NutritionMealSlot;
  nutrients: string[];
}
export class PlanValidationError extends Error {
  constructor(readonly code: FailureCode, readonly retryable: boolean, message: string,
    readonly issue?: ValidationIssue) { super(message); }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

/** The AI's raw, self-estimated item — IS the final persisted shape (`NutritionPlanFoodItem`), just not yet validated. */
const INGREDIENT_ORIGINS = ['plant', 'mineral', 'dairy', 'egg', 'fish', 'shellfish', 'terrestrial_animal', 'other_animal', 'unknown'] as const;
type IngredientOrigin = typeof INGREDIENT_ORIGINS[number];
export interface FoodRestrictions { dietaryPattern: DietaryPattern; excludedFoodNames: readonly string[] }

export interface RawAiFoodItem {
  name: string;
  quantity: number;
  unit: string;
  preparationNote: string;
  estimatedNutrition: { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };
  allergens: string[];
  ingredients: { name: string; origin: IngredientOrigin }[];
}
export interface RawMealOptions { recommendedOptionIndex: number; options: { foods: RawAiFoodItem[] }[] }

/** The AI's raw full-plan output for one meal (cost pass, 2026-10-10) — exactly one option, no options/recommendedOptionIndex wrapper. */
export interface RawAiFullPlanMeal { slot: NutritionMealSlot; foods: RawAiFoodItem[] }

function validRawFoodItem(value: unknown): value is RawAiFoodItem {
  if (!record(value) || !exactKeys(value, ['name', 'quantity', 'unit', 'preparationNote', 'estimatedNutrition', 'allergens', 'ingredients'])) return false;
  if (!Array.isArray(value.ingredients) || value.ingredients.length < 1 || value.ingredients.length > 30
    || value.ingredients.some((ingredient) => !record(ingredient) || !exactKeys(ingredient, ['name', 'origin'])
      || typeof ingredient.name !== 'string' || !ingredient.name.trim() || ingredient.name.length > 120
      || !INGREDIENT_ORIGINS.includes(ingredient.origin as IngredientOrigin))) return false;
  if (typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 120) return false;
  if (typeof value.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity <= 0 || value.quantity > 5000) return false;
  if (typeof value.unit !== 'string' || value.unit.length < 1 || value.unit.length > 24) return false;
  if (typeof value.preparationNote !== 'string' || value.preparationNote.length > 200) return false;
  if (!record(value.estimatedNutrition)) return false;
  try { validateNutritionValues(value.estimatedNutrition as unknown as NutritionFoodNutritionValues); }
  catch { return false; }
  if (typeof value.estimatedNutrition.fiberG !== 'number') return false;
  if (!Array.isArray(value.allergens) || value.allergens.length > 9
    || new Set(value.allergens).size !== value.allergens.length
    || value.allergens.some((allergen) => !NUTRITION_FOOD_ALLERGENS.includes(allergen as NutritionFoodAllergen))) return false;
  return true;
}

/** Shared bounds for one meal's option set — reused by the full-plan parser and the meal-alternative parser. */
function validMealOptionsShape(value: unknown): value is RawMealOptions {
  if (!record(value) || !exactKeys(value, ['recommendedOptionIndex', 'options'])
    || !Array.isArray(value.options) || value.options.length < 2 || value.options.length > 3
    || !Number.isInteger(value.recommendedOptionIndex) || (value.recommendedOptionIndex as number) < 0
    || (value.recommendedOptionIndex as number) >= value.options.length) return false;
  for (const option of value.options) {
    if (!record(option) || !exactKeys(option, ['foods']) || !Array.isArray(option.foods)
      || option.foods.length < 1 || option.foods.length > 8) return false;
    for (const food of option.foods) if (!validRawFoodItem(food)) return false;
  }
  return true;
}

/** The AI's raw, parsed plan output — one `RawAiFullPlanMeal` per slot (cost pass, 2026-10-10: exactly one option per meal, no options/recommendedOptionIndex wrapper). Kept local (not the shared `NutritionAiMealPlanOutput` contract type) so this file's own runtime-validated shape is what callers actually get, with no cast gap between the two. */
export interface ParsedAiMealPlanOutput { meals: RawAiFullPlanMeal[] }

/** Runtime enforcement of the closed canonical AI schema, independently of provider guarantees. */
export function parseAiOutput(value: unknown): ParsedAiMealPlanOutput {
  const invalid = () => { throw new PlanValidationError('AI_SCHEMA_INVALID', true, 'invalid_schema'); };
  if (!record(value) || !exactKeys(value, ['meals']) || !Array.isArray(value.meals)
    || value.meals.length < 2 || value.meals.length > 6) return invalid();
  for (const meal of value.meals) {
    if (!record(meal) || !exactKeys(meal, ['slot', 'foods'])
      || !NUTRITION_MEAL_SLOTS.includes(meal.slot as NutritionMealSlot)
      || !Array.isArray(meal.foods) || meal.foods.length < 1 || meal.foods.length > 8
      || meal.foods.some((food) => !validRawFoodItem(food))) return invalid();
  }
  return value as unknown as ParsedAiMealPlanOutput;
}

/** Runtime enforcement of a single meal's alternative output shape. */
export function parseAiMealAlternativeOutput(value: unknown): RawMealOptions {
  if (!validMealOptionsShape(value)) throw new PlanValidationError('AI_SCHEMA_INVALID', true, 'invalid_schema');
  return value;
}

function totals(values: ReturnType<typeof roundNutritionValues>): NutritionTotals {
  if (values.fiberG == null) throw new PlanValidationError('AI_SAFETY_VALIDATION_FAILED', false, 'unknown_fiber');
  return { kcal: values.kcal, proteinG: values.proteinG, carbsG: values.carbsG,
    fatG: values.fatG, fiberG: values.fiberG };
}
function within(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min - 0.01 && value <= range.max + 0.01;
}
function validMealTotals(total: NutritionTotals, target: MealNutritionTarget): boolean {
  return within(total.kcal, target.kcal) && within(total.proteinG, target.proteinG)
    && within(total.carbsG, target.carbsG) && within(total.fatG, target.fatG)
    && (!target.fiberG || within(total.fiberG, target.fiberG));
}

/** Uniformly scales an item's quantity AND its own estimated nutrition by the same deterministic factor — the free-form equivalent of the old "scale grams, recompute from per-100g" correction. */
function scaleFoodItem(item: RawAiFoodItem, factor: number): RawAiFoodItem {
  return {
    ...item,
    quantity: Math.round(item.quantity * factor * 100) / 100,
    estimatedNutrition: {
      kcal: item.estimatedNutrition.kcal * factor, proteinG: item.estimatedNutrition.proteinG * factor,
      carbsG: item.estimatedNutrition.carbsG * factor, fatG: item.estimatedNutrition.fatG * factor,
      fiberG: item.estimatedNutrition.fiberG * factor,
    },
  };
}

export interface BuiltMealOptions { options: NutritionMealOption[]; recommendedOptionId: string; corrected: boolean }

/** Shared safety and macro validation for every full-plan and alternative option. */
export function buildMealOptions(
  slot: NutritionMealSlot, raw: RawMealOptions, target: MealNutritionTarget,
  excludedAllergens: readonly NutritionFoodAllergen[], allowCorrection: boolean, restrictions?: FoodRestrictions,
): BuiltMealOptions {
  let corrected = false;
  const options = raw.options.map((option, optionIndex) => {
    for (const item of option.foods) {
      const violation = foodRestrictionViolation(item, excludedAllergens, restrictions);
      if (violation) throw new PlanValidationError('AI_SAFETY_VALIDATION_FAILED', false, violation);
    }
    const calculate = (items: readonly RawAiFoodItem[]) => totals(roundNutritionValues(sumNutritionValues(
      items.map((item) => item.estimatedNutrition))));
    let items = option.foods;
    let total = calculate(items);
    if (!validMealTotals(total, target) && allowCorrection && total.kcal > 0) {
      const factor = target.kcal.target / total.kcal;
      if (factor >= 0.5 && factor <= 2) {
        const proposal = items.map((item) => scaleFoodItem(item, factor));
        const adjustedTotal = calculate(proposal);
        if (validMealTotals(adjustedTotal, target)) { items = proposal; total = adjustedTotal; corrected = true; }
      }
    }
    if (!validMealTotals(total, target)) {
      const nutrients = (['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const)
        .filter((key) => target[key] && !within(total[key], target[key]!))
        .map((key) => `${key}:${total[key] < target[key]!.min ? 'below_min' : 'above_max'}`);
      throw new PlanValidationError('AI_MACRO_VALIDATION_FAILED', true, 'meal_target_deviation',
        { scope: 'meal', slot, nutrients });
    }
    return {
      id: `${slot}-${optionIndex + 1}`,
      foods: items.map((item) => ({
        name: item.name, quantity: item.quantity, unit: item.unit, preparationNote: item.preparationNote,
        estimatedNutrition: { kcal: item.estimatedNutrition.kcal, proteinG: item.estimatedNutrition.proteinG,
          carbsG: item.estimatedNutrition.carbsG, fatG: item.estimatedNutrition.fatG, fiberG: item.estimatedNutrition.fiberG },
        allergens: item.allergens as NutritionFoodAllergen[],
      })),
      totals: total,
    };
  });
  return { options, recommendedOptionId: options[raw.recommendedOptionIndex].id, corrected };
}

export interface ValidatedPlan { meals: NutritionMeal[]; dailyTotals: NutritionTotals; corrected: boolean }

/** The only plan assembly path — the AI's own macro estimates are validated/corrected against the Engine's deterministic targets, never recomputed from a catalog. */
export function validateAndBuildPlan(
  raw: unknown, mealSlots: readonly NutritionMealSlot[], engine: NutritionEngineOutput,
  excludedAllergens: readonly NutritionFoodAllergen[] = [], allowCorrection = true, restrictions?: FoodRestrictions,
): ValidatedPlan {
  const output = parseAiOutput(raw);
  if (output.meals.length !== mealSlots.length
    || output.meals.some((meal, index) => meal.slot !== mealSlots[index])) {
    throw new PlanValidationError('AI_SCHEMA_INVALID', true, 'meal_slots_mismatch');
  }
  let corrected = false;
  const meals = output.meals.map((meal, mealIndex): NutritionMeal => {
    // Full-plan output is a single option per meal (cost pass, 2026-10-10)
    // — wrap it into the shared `RawMealOptions` shape so it reuses the
    // same macro-correction/validation path as a meal alternative's 2-3
    // options, with no behavioral difference beyond the option count.
    const raw: RawMealOptions = { recommendedOptionIndex: 0, options: [{ foods: meal.foods }] };
    const built = buildMealOptions(meal.slot, raw, engine.mealTargets[mealIndex], excludedAllergens, allowCorrection, restrictions);
    corrected = corrected || built.corrected;
    return { slot: meal.slot, recommendedOptionId: built.recommendedOptionId, options: built.options };
  });
  const chosen = meals.map((meal) => meal.options.find((option) => option.id === meal.recommendedOptionId)!);
  const daily = totals(roundNutritionValues(sumNutritionValues(chosen.map((option) => option.totals))));
  const delta = (value: number, target: number, tolerance: number) => Math.abs(value - target) <= target * tolerance + 0.01;
  if (!delta(daily.kcal, engine.energy.targetKcal, TOLERANCE_PERCENT.calories)
    || !delta(daily.proteinG, engine.macros.proteinG, TOLERANCE_PERCENT.protein)
    || !delta(daily.carbsG, engine.macros.carbsG, TOLERANCE_PERCENT.carbohydrates)
    || !delta(daily.fatG, engine.macros.fatG, TOLERANCE_PERCENT.fat)
    || !delta(daily.fiberG, engine.macros.fiberG, TOLERANCE_PERCENT.fiber)) {
    throw new PlanValidationError('AI_MACRO_VALIDATION_FAILED', true, 'daily_target_deviation',
      { scope: 'daily', nutrients: [] });
  }
  return { meals, dailyTotals: daily, corrected };
}

export interface ValidatedMealAlternative { options: NutritionMealOption[]; recommendedOptionId: string; corrected: boolean }

/**
 * Validates a standalone meal alternative against the SAME per-meal target
 * the active plan already computed for this slot — never recalculates TDEE/
 * macros/the Nutrition Engine (round brief §12).
 */
export function validateAndBuildMealAlternative(
  raw: unknown, slot: NutritionMealSlot, target: MealNutritionTarget,
  excludedAllergens: readonly NutritionFoodAllergen[] = [], allowCorrection = true, restrictions?: FoodRestrictions,
): ValidatedMealAlternative {
  const raw2 = parseAiMealAlternativeOutput(raw);
  return buildMealOptions(slot, raw2, target, excludedAllergens, allowCorrection, restrictions);
}
