import { describe, expect, it } from 'vitest';
import { planSnapshotNutrition, validatePlanSnapshotBase } from '../snapshot';
const base = { name: 'Synthetic oats', quantity: 40, unit: 'g', preparationNote: 'Synthetic preparation',
  nutrition: { kcal: 156, proteinG: 6.8, carbsG: 26.5, fatG: 2.8, fiberG: 4.2 } };
describe('immutable plan snapshot arithmetic', () => {
  it.each(['g', 'ml', 'unidade'])('retains original %s amount and nutrition; has no gram conversion', unit => {
    const b = { ...base, unit }; expect(planSnapshotNutrition(b, 40)).toEqual(base.nutrition);
    expect(b).toEqual({ ...base, unit });
  });
  it('edits fractions from the base, independent of previous edits and rounding', () => {
    expect(planSnapshotNutrition(base, 13.33).kcal).toBe(51.99);
    expect(planSnapshotNutrition(base, 20)).toEqual({ kcal: 78, proteinG: 3.4, carbsG: 13.25, fatG: 1.4, fiberG: 2.1 });
    expect(planSnapshotNutrition(base, 40)).toEqual(base.nutrition);
  });
  it.each([0, -1, NaN, Infinity, 5001])('rejects invalid amount %s', quantity => expect(() => planSnapshotNutrition(base, quantity)).toThrow());
  it('does not turn missing fiber into zero', () => expect(() => validatePlanSnapshotBase({ ...base, nutrition: { ...base.nutrition, fiberG: null } })).toThrow());
});
