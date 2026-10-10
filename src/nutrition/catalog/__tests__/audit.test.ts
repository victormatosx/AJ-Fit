import { describe, expect, it } from 'vitest';
import { buildCatalogAuditReport } from '../audit';
import type { NutritionFood } from '../../../types/nutrition';

function food(overrides: Partial<NutritionFood>): NutritionFood {
  return {
    id: 'nf_test', name: 'Test food', aliases: [], category: 'cereal',
    source: { type: 'manual', sourceId: 'test', sourceName: 'test' },
    nutritionPer100g: { kcal: 100, proteinG: 2, carbsG: 20, fatG: 1, fiberG: 1 },
    dietaryFlags: { vegetarian: null, vegan: null, pescatarian: null },
    allergens: null,
    preparation: 'cooked', mealContexts: ['breakfast', 'snack', 'main_meal', 'supper'],
    generationStatus: 'pending_review',
    catalogVersion: 'test-v1', searchPrefixes: [], createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

describe('buildCatalogAuditReport', () => {
  it('reports zero known allergens/dietary flags when every food is pending review (no invented data)', () => {
    const foods = [food({ id: '1' }), food({ id: '2', category: 'protein_source' })];
    const report = buildCatalogAuditReport(foods);
    expect(report.statusCounts).toEqual({ pending_review: 2 });
    expect(report.anyFoodWithKnownAllergens).toBe(0);
    expect(report.anyFoodWithResolvedDietaryFlags).toBe(0);
  });

  it('counts approved/reviewed foods by category once they are actually reviewed and approved', () => {
    const reviewed = (overrides: Partial<NutritionFood>) => food({
      allergens: [], dietaryFlags: { vegetarian: true, vegan: true, pescatarian: true },
      generationStatus: 'approved', ...overrides,
    });
    const foods = [
      reviewed({ id: 'c1', category: 'cereal' }), reviewed({ id: 'c2', category: 'cereal' }),
      reviewed({ id: 'p1', category: 'protein_source' }),
    ];
    const report = buildCatalogAuditReport(foods);
    expect(report.statusCounts).toEqual({ approved: 3 });
    expect(report.byCategory).toEqual({ cereal: 2, protein_source: 1 });
    expect(report.approvedWithKnownAllergens).toBe(3);
  });

  it('excludes approved foods with unknown fiber from the fiber-known count (missing != 0)', () => {
    const foods = [food({ id: '1', generationStatus: 'approved', allergens: [],
      dietaryFlags: { vegetarian: true, vegan: true, pescatarian: true },
      nutritionPer100g: { kcal: 100, proteinG: 2, carbsG: 20, fatG: 1, fiberG: null } })];
    const report = buildCatalogAuditReport(foods);
    expect(report.approvedWithFiberKnown).toBe(0);
    expect(report.approvedMissingFiber).toBe(1);
  });
});
