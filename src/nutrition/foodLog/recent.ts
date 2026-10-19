import type { NutritionDailyLog } from '../../types/nutrition';

function timestampMillis(value: unknown): number {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

/** Derives a small recent-id set from diary data already loaded by the UI; performs no reads. */
export function recentFoodLogIds<TTimestamp>(logs: readonly NutritionDailyLog<TTimestamp>[], maxIds = 20): string[] {
  if (!Number.isInteger(maxIds) || maxIds < 1) return [];
  const items = logs.flatMap((day) => day.meals.flatMap((meal) => meal.items))
    .filter((item) => item.source === 'food_log_catalog' && item.foodId.startsWith('flc_'))
    .sort((a, b) => timestampMillis(b.loggedAt) - timestampMillis(a.loggedAt));
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.source !== 'food_log_catalog') continue;
    if (seen.has(item.foodId)) continue;
    seen.add(item.foodId); ids.push(item.foodId);
    if (ids.length >= maxIds) break;
  }
  return ids;
}
