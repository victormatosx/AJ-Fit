import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { foodNames } from '../../../nutrition/ui/planView';
import type { NutritionMeal } from '../../../types/nutrition';

const source = readFileSync('src/components/nutrition/MealCard.tsx', 'utf8');

/**
 * Regression for the diet-quality-v3 crash: a freshly generated plan's items
 * are free-form AI names with no `foodId`/`sourceId` (never resolved against
 * `nutritionFoods`) — `formatFoodDisplayName` (catalog-only TACO/TBCA
 * comma-chain reordering) must never be applied to them, since that's what
 * threw `Cannot read property 'trim' of undefined` once a stale build no
 * longer matched the frontend's free-form contract.
 */
function freeFormMeal(): NutritionMeal {
  return {
    slot: 'lunch',
    recommendedOptionId: 'lunch-1',
    options: [
      {
        id: 'lunch-1',
        foods: [
          { name: 'Arroz branco cozido', quantity: 150, unit: 'g', preparationNote: 'cozido', estimatedNutrition: { kcal: 190, proteinG: 4, carbsG: 41, fatG: 0.4, fiberG: 1 }, allergens: [] },
          { name: 'Feijão carioca cozido', quantity: 100, unit: 'g', preparationNote: '', estimatedNutrition: { kcal: 76, proteinG: 5, carbsG: 14, fatG: 0.5, fiberG: 6 }, allergens: [] },
        ],
        totals: { kcal: 266, proteinG: 9, carbsG: 55, fatG: 0.9, fiberG: 7 },
      },
    ],
  };
}

describe('MealCard — free-form plan items, no catalog dependency', () => {
  it('renders the AI\'s own names, with no foodId/sourceId on the items', () => {
    const meal = freeFormMeal();
    for (const food of meal.options[0].foods) {
      expect('foodId' in food).toBe(false);
      expect('sourceId' in food).toBe(false);
    }
    expect(foodNames(meal)).toBe('Arroz branco cozido, Feijão carioca cozido');
  });

  it('never throws for a plan item name that a catalog-oriented formatter would mishandle', () => {
    const meal = freeFormMeal();
    meal.options[0].foods[0].name = 'Omelete, 2 ovos, com queijo';
    expect(() => foodNames(meal)).not.toThrow();
    expect(foodNames(meal)).toContain('Omelete, 2 ovos, com queijo');
  });

  it('never calls formatFoodDisplayName — that formatter is catalog-only', () => {
    expect(source).not.toMatch(/formatFoodDisplayName/);
  });
});
