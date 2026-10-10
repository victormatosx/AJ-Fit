import { describe, expect, it } from 'vitest';
import { recentFoodLogIds } from '../recent';
import type { NutritionDailyLog } from '../../../types/nutrition';

function log(items: { foodId: string; source: 'food_log_catalog' | 'catalog'; millis: number }[]): NutritionDailyLog {
  return { localDate: '2026-10-09', meals: [{ slot: 'breakfast', items: items.map((item, index) => ({
    id: String(index), foodId: item.foodId, source: item.source, grams: 100,
    snapshot: { name: item.foodId, kcal: 1, proteinG: 1, carbsG: 1, fatG: 1, fiberG: null },
    loggedAt: { toMillis: () => item.millis },
  })), totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 } }], updatedAt: null } as NutritionDailyLog;
}

describe('recentFoodLogIds', () => {
  it('returns unique flc ids newest-first without extra reads', () => {
    const result = recentFoodLogIds([log([
      { foodId: 'flc_old', source: 'food_log_catalog', millis: 1 },
      { foodId: 'nf_ignore', source: 'catalog', millis: 4 },
      { foodId: 'flc_new', source: 'food_log_catalog', millis: 3 },
      { foodId: 'flc_old', source: 'food_log_catalog', millis: 2 },
    ])]);
    expect(result).toEqual(['flc_new', 'flc_old']);
  });

  it('honors the small max and rejects invalid max values', () => {
    const data = [log([
      { foodId: 'flc_a', source: 'food_log_catalog', millis: 1 },
      { foodId: 'flc_b', source: 'food_log_catalog', millis: 2 },
    ])];
    expect(recentFoodLogIds(data, 1)).toEqual(['flc_b']);
    expect(recentFoodLogIds(data, 0)).toEqual([]);
  });
});
