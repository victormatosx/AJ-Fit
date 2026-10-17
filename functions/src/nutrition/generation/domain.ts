import { foodRestrictionViolation } from './restrictions';
import {
  NUTRITION_FOOD_ALLERGENS,
  type NutritionFoodNutritionValues, type NutritionMeal, type NutritionMealOption,
  type NutritionMealSlot, type NutritionEngineOutput, type MealNutritionTarget,
  type DietaryPattern, type NutritionTotals, type NutritionFoodAllergen, NUTRITION_MEAL_SLOTS,
} from '../shared/types/nutrition';
import { roundNutritionValues, sumNutritionValues, validateNutritionValues } from '../shared/nutrition/catalog/math';
import { TOLERANCE_PERCENT } from '../shared/nutrition/engine/constants';
import { admissibleScale, scaledPortions, scaleCandidates, validPortion } from './correction';
import { NUTRIENTS, nutrientDeviations, withinNutritionRange, type MealValidationDiagnostic,
  type ValidationDiagnostics } from './diagnostics';

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
    readonly issue?: ValidationIssue, readonly diagnostics?: ValidationDiagnostics,
    /** In-memory repair context only. Never log or persist the error object. */
    readonly repairCandidate?: unknown) { super(message); }
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
  if (!validPortion(value as unknown as RawAiFoodItem)) return false;
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
function validMealTotals(total: NutritionTotals, target: MealNutritionTarget): boolean {
  return NUTRIENTS.every((key) => !target[key] || withinNutritionRange(total[key], target[key]!));
}

function assertFoodSafety(items: readonly RawAiFoodItem[], excludedAllergens: readonly NutritionFoodAllergen[], restrictions?: FoodRestrictions): void {
  // Scan the complete candidate BEFORE any macro correction or early rejection.
  // Only closed reason enums leave this function; food names never enter errors.
  const violations = items.map((item) => foodRestrictionViolation(item, excludedAllergens, restrictions));
  const violation = violations.find(Boolean);
  if (violation) throw new PlanValidationError('AI_SAFETY_VALIDATION_FAILED', false, violation);
}

function calculateItems(items: readonly RawAiFoodItem[]): NutritionTotals {
  return totals(roundNutritionValues(sumNutritionValues(items.map((item) => item.estimatedNutrition))));
}

/** Evaluates every option without throwing on macro deviations, so the caller
 * can collect the whole candidate and run the daily check before deciding retry. */
function evaluateMealOptions(
  slot: NutritionMealSlot, raw: RawMealOptions, target: MealNutritionTarget,
  excludedAllergens: readonly NutritionFoodAllergen[], allowCorrection: boolean, restrictions?: FoodRestrictions, preferCalories = false,
): BuiltMealOptions {
  let corrected = false;
  const diagnostics: ValidationDiagnostics = { meals: [], daily: { status: 'not_applicable', deviations: [] } };
  const options = raw.options.map((option, optionIndex) => {
    let items = option.foods;
    let total = calculateItems(items);
    const diagnostic: MealValidationDiagnostic = { slot, optionIndex, status: 'passed', deviations: nutrientDeviations(total, target),
      correction: { attempted: false, status: 'not_needed', interval: null, factor: null, reason: null } };
    if (diagnostic.deviations.length && allowCorrection) {
      const scale = admissibleScale(total, target);
      diagnostic.correction = { attempted: true, status: 'rejected', interval: scale.interval, factor: null, reason: scale.reason };
      if (scale.interval) {
        const calorieFactor = total.kcal > 0 ? target.kcal.target / total.kcal : 1;
        const candidates = scaleCandidates(scale.interval);
        if (preferCalories && calorieFactor >= scale.interval.min && calorieFactor <= scale.interval.max) candidates.unshift(calorieFactor);
        for (const factor of candidates) {
          diagnostic.correction.factor = factor;
          const proposal = scaledPortions(items, factor);
          if (!proposal.items || !proposal.items.every(validRawFoodItem)) {
            diagnostic.correction.reason = proposal.reason ?? 'invalid_portion';
            continue;
          }
          assertFoodSafety(proposal.items, excludedAllergens, restrictions);
          const adjustedTotal = calculateItems(proposal.items);
          if (!validMealTotals(adjustedTotal, target)) {
            diagnostic.correction.reason = 'quantized_out_of_range';
            continue;
          }
          items = proposal.items; total = adjustedTotal; corrected = true;
          diagnostic.correction.status = 'applied'; diagnostic.correction.reason = null;
          break;
        }
      }
    } else if (diagnostic.deviations.length) {
      diagnostic.correction.status = 'disabled';
    }
    if (!validMealTotals(total, target)) {
      diagnostic.status = 'failed';
    }
    diagnostics.meals.push(diagnostic);
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
  return { options, recommendedOptionId: options[raw.recommendedOptionIndex].id, corrected, diagnostics };
}

export interface BuiltMealOptions { options: NutritionMealOption[]; recommendedOptionId: string; corrected: boolean; diagnostics: ValidationDiagnostics }

function assertMacroDiagnostics(diagnostics: ValidationDiagnostics, repairCandidate?: () => unknown): void {
  const meal = diagnostics.meals.find((entry) => entry.status === 'failed');
  if (meal) throw new PlanValidationError('AI_MACRO_VALIDATION_FAILED', true, 'meal_target_deviation',
    { scope: 'meal', slot: meal.slot, nutrients: meal.deviations.map((entry) => `${entry.nutrient}:${entry.direction}`) }, diagnostics, repairCandidate?.());
  if (diagnostics.daily.status === 'failed') throw new PlanValidationError('AI_MACRO_VALIDATION_FAILED', true, 'daily_target_deviation',
    { scope: 'daily', nutrients: diagnostics.daily.deviations.map((entry) => `${entry.nutrient}:${entry.direction}`) }, diagnostics, repairCandidate?.());
}

export function buildMealOptions(
  slot: NutritionMealSlot, raw: RawMealOptions, target: MealNutritionTarget,
  excludedAllergens: readonly NutritionFoodAllergen[], allowCorrection: boolean, restrictions?: FoodRestrictions,
): BuiltMealOptions {
  assertFoodSafety(raw.options.flatMap((option) => option.foods), excludedAllergens, restrictions);
  const built = evaluateMealOptions(slot, raw, target, excludedAllergens, allowCorrection, restrictions);
  assertMacroDiagnostics(built.diagnostics, () => ({ recommendedOptionIndex: raw.recommendedOptionIndex,
    options: built.options.map((option, i) => ({ foods: option.foods.map((item, j) => ({ ...item,
      ingredients: raw.options[i].foods[j].ingredients })) })) }));
  return built;
}

export interface ValidatedPlan { meals: NutritionMeal[]; dailyTotals: NutritionTotals; corrected: boolean; diagnostics: ValidationDiagnostics }

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
  assertFoodSafety(output.meals.flatMap((meal) => meal.foods), excludedAllergens, restrictions);
  let candidate = buildPlanCandidate(output, mealSlots, engine, excludedAllergens, allowCorrection, restrictions);
  // Nearest-to-one corrections can collectively miss a stricter daily range
  // (including cumulative rounding margins). Try the calorie-centered candidate
  // locally, still inside ALL nutrient intervals, before paying for another call.
  if (candidate.corrected && candidate.diagnostics.daily.status === 'failed'
    && candidate.diagnostics.meals.every((meal) => meal.status === 'passed')) {
    candidate = buildPlanCandidate(output, mealSlots, engine, excludedAllergens, allowCorrection, restrictions, true);
  }
  assertMacroDiagnostics(candidate.diagnostics, () => ({ meals: candidate.meals.map((meal, i) => ({ slot: meal.slot,
    foods: meal.options[0].foods.map((item, j) => ({ ...item, ingredients: output.meals[i].foods[j].ingredients })) })) }));
  return candidate;
}

function buildPlanCandidate(
  output: ParsedAiMealPlanOutput, mealSlots: readonly NutritionMealSlot[], engine: NutritionEngineOutput,
  excludedAllergens: readonly NutritionFoodAllergen[], allowCorrection: boolean, restrictions?: FoodRestrictions, preferCalories = false,
): ValidatedPlan {
  let corrected = false;
  const diagnostics: ValidationDiagnostics = { meals: [], daily: { status: 'not_applicable', deviations: [] } };
  const meals = output.meals.map((meal, mealIndex): NutritionMeal => {
    // Full-plan output is a single option per meal (cost pass, 2026-10-10)
    // — wrap it into the shared `RawMealOptions` shape so it reuses the
    // same macro-correction/validation path as a meal alternative's 2-3
    // options, with no behavioral difference beyond the option count.
    const raw: RawMealOptions = { recommendedOptionIndex: 0, options: [{ foods: meal.foods }] };
    const built = evaluateMealOptions(meal.slot, raw, engine.mealTargets[mealIndex], excludedAllergens, allowCorrection, restrictions, preferCalories);
    diagnostics.meals.push(...built.diagnostics.meals);
    corrected = corrected || built.corrected;
    return { slot: meal.slot, recommendedOptionId: built.recommendedOptionId, options: built.options };
  });
  const chosen = meals.map((meal) => meal.options.find((option) => option.id === meal.recommendedOptionId)!);
  const daily = totals(roundNutritionValues(sumNutritionValues(chosen.map((option) => option.totals))));
  const range = (target: number, tolerance: number) => ({ target, min: target * (1 - tolerance), max: target * (1 + tolerance) });
  const dailyTarget: MealNutritionTarget = { slot: mealSlots[0], kcal: range(engine.energy.targetKcal, TOLERANCE_PERCENT.calories),
    proteinG: range(engine.macros.proteinG, TOLERANCE_PERCENT.protein), carbsG: range(engine.macros.carbsG, TOLERANCE_PERCENT.carbohydrates),
    fatG: range(engine.macros.fatG, TOLERANCE_PERCENT.fat), fiberG: range(engine.macros.fiberG, TOLERANCE_PERCENT.fiber) };
  const deviations = nutrientDeviations(daily, dailyTarget);
  diagnostics.daily = { status: deviations.length ? 'failed' : 'passed', deviations };
  return { meals, dailyTotals: daily, corrected, diagnostics };
}

export type ValidatedMealAlternative = BuiltMealOptions;

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
