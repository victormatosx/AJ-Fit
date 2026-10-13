import { describe, expect, it } from 'vitest';
import { calculateEnergyTarget } from '../calculateEnergyTarget';
import { NutritionEngineError } from '../errors';

describe('calculateEnergyTarget — goal adjustment', () => {
  const tdee = 2000;

  it.each([
    ['gradual', 0.90],
    ['moderate', 0.85],
    ['accelerated', 0.80],
  ] as const)('weight_loss, pace=%s -> tdee * %s', (pace, factor) => {
    const result = calculateEnergyTarget(tdee, 'weight_loss', pace, 'm');
    expect(result.targetKcal).toBeCloseTo(tdee * factor, 5);
  });

  it.each([
    ['gradual', 1.05],
    ['moderate', 1.10],
    ['accelerated', 1.15],
  ] as const)('muscle_gain, pace=%s -> tdee * %s', (pace, factor) => {
    const result = calculateEnergyTarget(tdee, 'muscle_gain', pace, 'm');
    expect(result.targetKcal).toBeCloseTo(tdee * factor, 5);
  });

  it('maintenance ignores pace entirely -> targetKcal === tdee', () => {
    expect(calculateEnergyTarget(tdee, 'maintenance', undefined, 'm').targetKcal).toBeCloseTo(tdee, 5);
    expect(calculateEnergyTarget(tdee, 'maintenance', 'accelerated', 'm').targetKcal).toBeCloseTo(tdee, 5);
  });

  it('body_recomposition is pace-independent: fixed 10% deficit regardless of pace', () => {
    expect(calculateEnergyTarget(tdee, 'body_recomposition', undefined, 'm').targetKcal).toBeCloseTo(tdee * 0.90, 5);
    expect(calculateEnergyTarget(tdee, 'body_recomposition', 'gradual', 'm').targetKcal)
      .toBeCloseTo(calculateEnergyTarget(tdee, 'body_recomposition', 'accelerated', 'm').targetKcal, 5);
  });

  it('weight_loss/muscle_gain without a pace throws PROGRESSION_PACE_REQUIRED', () => {
    try {
      calculateEnergyTarget(tdee, 'weight_loss', undefined, 'm');
      throw new Error('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NutritionEngineError);
      expect((error as NutritionEngineError).code).toBe('PROGRESSION_PACE_REQUIRED');
    }
  });
});

describe('calculateEnergyTarget — safety clamp boundary', () => {
  it('exactly at the female floor (1200) is NOT clamped (< floor is the clamp condition, not <=)', () => {
    const result = calculateEnergyTarget(1200, 'maintenance', undefined, 'f');
    expect(result.safetyClampApplied).toBe(false);
    expect(result.targetKcal).toBe(1200);
  });

  it('just below the female floor (1199.99) IS clamped up to 1200', () => {
    const result = calculateEnergyTarget(1199.99, 'maintenance', undefined, 'f');
    expect(result.safetyClampApplied).toBe(true);
    expect(result.targetKcal).toBe(1200);
  });

  it('just above the female floor (1200.01) is NOT clamped', () => {
    const result = calculateEnergyTarget(1200.01, 'maintenance', undefined, 'f');
    expect(result.safetyClampApplied).toBe(false);
    expect(result.targetKcal).toBeCloseTo(1200.01, 5);
  });

  it('male floor is 1500, independent from the female floor', () => {
    expect(calculateEnergyTarget(1499.99, 'maintenance', undefined, 'm').safetyClampApplied).toBe(true);
    expect(calculateEnergyTarget(1500.01, 'maintenance', undefined, 'm').safetyClampApplied).toBe(false);
  });

  it('clamp is applied AFTER the goal adjustment, not before (an aggressive deficit can trigger it even when TDEE is comfortably above the floor)', () => {
    // tdee=1300 (f), accelerated weight_loss -> 1300*0.8=1040 < 1200 floor
    const result = calculateEnergyTarget(1300, 'weight_loss', 'accelerated', 'f');
    expect(result.safetyClampApplied).toBe(true);
    expect(result.targetKcal).toBe(1200);
  });
});
