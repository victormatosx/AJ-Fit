import type { NutritionLoggedFoodItem, NutritionPlanSnapshotBase, NutritionTotals } from '../../types/nutrition';
import { roundNutrition, validateNutritionValues } from '../catalog/math';

export const DIARY_MAX_ITEMS_PER_MEAL = 8;
export const DIARY_MAX_ITEMS_PER_DAY = 48;
export const DIARY_NUTRIENTS = ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const;

export function validatePlanSnapshotBase(value: unknown): asserts value is NutritionPlanSnapshotBase {
  if (!value || typeof value !== 'object') throw new Error('INVALID_PLAN_SNAPSHOT');
  const b = value as NutritionPlanSnapshotBase;
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120
    || !Number.isFinite(b.quantity) || b.quantity <= 0 || b.quantity > 5000
    || typeof b.unit !== 'string' || !b.unit.trim() || b.unit.length > 24
    || typeof b.preparationNote !== 'string' || b.preparationNote.length > 200) throw new Error('INVALID_PLAN_SNAPSHOT');
  validateNutritionValues(b.nutrition);
  if (!DIARY_NUTRIENTS.every(k => typeof b.nutrition[k] === 'number' && Number.isFinite(b.nutrition[k]))) throw new Error('INVALID_PLAN_SNAPSHOT');
}

/** Always scales the immutable persisted base; never rounds and rescales the last edit. */
export function planSnapshotNutrition(base: NutritionPlanSnapshotBase, quantity: number): NutritionTotals {
  validatePlanSnapshotBase(base);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 5000) throw new Error('INVALID_DIARY_QUANTITY');
  const result = Object.fromEntries(DIARY_NUTRIENTS.map(k => [k, quantity === base.quantity
    ? base.nutrition[k] : roundNutrition(base.nutrition[k] * quantity / base.quantity)])) as unknown as NutritionTotals;
  validateNutritionValues(result);
  return result;
}
export function diaryItemQuantity(item: NutritionLoggedFoodItem): number {
  return item.source === 'plan_snapshot' ? item.quantity : item.grams;
}
export function diaryItemUnit(item: NutritionLoggedFoodItem): string {
  return item.source === 'plan_snapshot' ? item.unit : 'g';
}
