import type { MealNutritionTarget, NutritionMealSlot, NutritionTotals } from '../shared/types/nutrition';
import { logInfo } from '../../lib/logger';

export const NUTRIENTS = ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const;
export type Nutrient = typeof NUTRIENTS[number];
export const ROUNDING_MARGIN = 0.01;
export interface NutrientDeviation {
  nutrient: Nutrient; observed: number; min: number; max: number;
  direction: 'below_min' | 'above_max'; absolute: number; percent: number | null;
}
export interface CorrectionDiagnostic {
  attempted: boolean;
  status: 'not_needed' | 'disabled' | 'applied' | 'rejected';
  interval: { min: number; max: number } | null;
  factor: number | null;
  reason: 'empty_intersection' | 'zero_nutrient' | 'ambiguous_unit' | 'invalid_portion'
    | 'quantized_out_of_range' | 'optimizer_infeasible' | null;
  /** Which mechanism actually produced `status: 'applied'` — absent for `not_needed`/`disabled`,
   * and for `rejected` outcomes where no mechanism ever reached a usable candidate.
   * Diagnostics are log-only (see `logValidationDiagnostics`), so adding this is not a persistence
   * contract change. */
  method?: 'uniform' | 'per_item';
}
export interface MealValidationDiagnostic {
  slot: NutritionMealSlot; optionIndex: number; status: 'passed' | 'failed';
  /** Original totals for failed or locally corrected options. Logs retain these
   * for audit; retry feedback omits applied options, which are already repaired. */
  deviations: NutrientDeviation[]; correction: CorrectionDiagnostic;
}
export interface ValidationDiagnostics {
  meals: MealValidationDiagnostic[];
  daily: { status: 'passed' | 'failed' | 'not_applicable'; deviations: NutrientDeviation[] };
}
export function withinNutritionRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min - ROUNDING_MARGIN && value <= range.max + ROUNDING_MARGIN;
}
export function nutrientDeviations(total: NutritionTotals, target: MealNutritionTarget): NutrientDeviation[] {
  return NUTRIENTS.flatMap((nutrient) => {
    const range = target[nutrient];
    if (!range || withinNutritionRange(total[nutrient], range)) return [];
    const observed = total[nutrient];
    const direction = observed < range.min ? 'below_min' as const : 'above_max' as const;
    const boundary = direction === 'below_min' ? range.min : range.max;
    const absolute = Math.abs(observed - boundary);
    const percent = boundary > 0 ? absolute / boundary * 100 : NaN;
    return [{ nutrient, observed, min: range.min, max: range.max, direction, absolute,
      percent: Number.isFinite(percent) ? percent : null }];
  });
}

/** No food text, profile data or model output may enter this projection. Numeric
 * diagnostics stay in logs, never in job/plan documents or analytics payloads. */
export function logValidationDiagnostics(diagnostics: ValidationDiagnostics | undefined, trace: { generationId: string; attempt: number }): void {
  if (!diagnostics) return;
  for (const meal of diagnostics.meals) {
    if (meal.correction.status === 'not_needed') continue;
    logInfo('nutrition.generation', 'meal_validation', { ...trace, slot: meal.slot, optionIndex: meal.optionIndex,
      validationStatus: meal.status, correctionAttempted: meal.correction.attempted, correctionStatus: meal.correction.status,
      factor: meal.correction.factor, factorMin: meal.correction.interval?.min ?? null,
      factorMax: meal.correction.interval?.max ?? null, rejectionReason: meal.correction.reason,
      correctionMethod: meal.correction.method ?? null });
    for (const deviation of meal.deviations) {
      logInfo('nutrition.generation', 'nutrient_deviation', { ...trace, scope: 'meal', slot: meal.slot,
        optionIndex: meal.optionIndex, ...deviation });
    }
  }
  logInfo('nutrition.generation', 'daily_validation', { ...trace, validationStatus: diagnostics.daily.status });
  for (const deviation of diagnostics.daily.deviations) {
    logInfo('nutrition.generation', 'nutrient_deviation', { ...trace, scope: 'daily', ...deviation });
  }
}

/** Serialize the same numeric diagnostics for the retry; rounding here limits
 * prompt size only and never participates in validation. Already corrected meals
 * are included in previousPlan, not repeated as failures in validation. */
/** `empty_intersection` (uniform corrector, single-item meals) and
 * `optimizer_infeasible` (per-item corrector, multi-item meals) both mean no
 * quantity-only adjustment can reconcile the meal's conflicting nutrient
 * deviations — the meal needs a different/additional food, not a rescale. */
const RECOMPOSITION_REASONS = new Set(['empty_intersection', 'optimizer_infeasible']);

export function validationRetryFeedback(code: string, issue: object | undefined,
  diagnostics: ValidationDiagnostics | undefined, previousPlan: unknown): string {
  if (!issue && !diagnostics) return code;
  const failedMeals = diagnostics?.meals.filter((meal) => meal.status === 'failed') ?? [];
  const validation: unknown = diagnostics ? JSON.parse(JSON.stringify({ ...diagnostics, meals: failedMeals },
  (_key, value: unknown) => typeof value === 'number' ? Number(value.toFixed(6)) : value)) : undefined;
  const recomposeSlots = [...new Set(failedMeals.filter((meal) => RECOMPOSITION_REASONS.has(meal.correction.reason ?? ''))
    .map((meal) => meal.slot))];
  const instruction = recomposeSlots.length
    ? `Repair all reported deviations using truthful portions and nutrition. For meal slot(s) ${recomposeSlots.join(', ')}, `
      + 'scaling the existing food(s) cannot reconcile the reported nutrient deviations (correction reason empty_intersection/optimizer_infeasible) '
      + '— add an additional food item or substitute a different food in that meal instead of only changing quantities. '
      + 'Preserve restrictions and already valid meals. Return the complete schema.'
    : 'Repair all reported deviations using truthful portions and nutrition. Preserve restrictions and already valid meals. Return the complete schema.';
  return JSON.stringify({ failureCode: code, ...issue, ...(validation ? { validation } : {}), instruction, previousPlan });
}
