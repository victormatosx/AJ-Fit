import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/nutrition/MealOptionCard.tsx', 'utf8');

/**
 * Regression: `item.estimatedNutrition` is absent on any plan item
 * persisted before diet-quality-v3 (see the type's comment in
 * `src/types/nutrition.ts`) — a direct `item.estimatedNutrition.kcal` read
 * threw `Cannot read property 'kcal' of undefined` for a historical plan's
 * options. Must always go through the null-safe `planItemKcal` helper.
 */
describe('MealOptionCard — estimatedNutrition may be absent on a historical plan item', () => {
  it('never reads item.estimatedNutrition.kcal directly', () => {
    expect(source).not.toMatch(/item\.estimatedNutrition\.kcal/);
    expect(source).toMatch(/kcal=\{planItemKcal\(item\)\}/);
  });
});
