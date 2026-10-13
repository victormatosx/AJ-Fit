import { describe, expect, it } from 'vitest';
import { calculateMacros } from '../calculateMacros';
import { NutritionEngineError } from '../errors';

describe('calculateMacros', () => {
  it('muscle_gain at 80kg: protein target 1.8 g/kg -> 144g', () => {
    const result = calculateMacros(2349.6, 80, 'muscle_gain');
    expect(result.proteinG).toBeCloseTo(144, 5);
  });

  it('weight_loss at 60kg: protein target 2.0 g/kg -> 120g', () => {
    const result = calculateMacros(1798.515, 60, 'weight_loss');
    expect(result.proteinG).toBeCloseTo(120, 5);
  });

  it('fat uses the %-of-calories target when it is above the g/kg floor', () => {
    // 80kg floor = 64g; 25% of 2349.6kcal / 9 = 65.2667g > floor -> uses target%
    const result = calculateMacros(2349.6, 80, 'muscle_gain');
    expect(result.fatG).toBeCloseTo(65.26667, 4);
  });

  it('fat falls back to the g/kg floor when the %-of-calories target would be lower', () => {
    // 70kg floor = 56g (504 kcal); 25% of 952 kcal / 9 = 26.44g < floor -> floor wins
    const result = calculateMacros(952, 70, 'maintenance');
    expect(result.fatG).toBeCloseTo(56, 5);
  });

  it('carbs = 0 is a valid result when protein + fat exactly consume the target (boundary, not an error)', () => {
    // protein 1.6*70=112g (448kcal) + fat floor 56g (504kcal) = 952kcal exactly
    const result = calculateMacros(952, 70, 'maintenance');
    expect(result.proteinG).toBeCloseTo(112, 5);
    expect(result.fatG).toBeCloseTo(56, 5);
    expect(result.carbsG).toBeCloseTo(0, 5);
    expect(result.carbsG).toBeGreaterThanOrEqual(0);
  });

  it('carbs are strictly positive once targetKcal exceeds protein+fat kcal even slightly', () => {
    const result = calculateMacros(953, 70, 'maintenance');
    expect(result.carbsG).toBeGreaterThan(0);
  });

  it('throws MACRO_ALLOCATION_INFEASIBLE (never a negative carb value) when protein + fat alone exceed the target', () => {
    // 150kg, muscle_gain protein = 1.8*150 = 270g = 1080 kcal alone > 500 kcal target
    try {
      calculateMacros(500, 150, 'muscle_gain');
      throw new Error('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NutritionEngineError);
      expect((error as NutritionEngineError).code).toBe('MACRO_ALLOCATION_INFEASIBLE');
    }
  });

  it.each(['weight_loss', 'muscle_gain', 'maintenance', 'body_recomposition'] as const)(
    '%s never returns a negative carbsG across a range of plausible targetKcal values',
    (goalCategory) => {
      for (const targetKcal of [1200, 1500, 1800, 2200, 2600, 3000]) {
        const result = calculateMacros(targetKcal, 70, goalCategory);
        expect(result.carbsG).toBeGreaterThanOrEqual(0);
      }
    },
  );
});
