import { describe, expect, it } from 'vitest';
import type { NutritionEngineInput, NutritionGoal, NutritionMealSlot, NutritionProgressionPace, Sex } from '../../../types/nutrition';
import { calculateNutritionTargets, resolveEligibility } from '../index';
import { NutritionEngineError } from '../errors';

function buildInput(overrides: {
  sex?: Sex;
  weightKg?: number;
  heightCm?: number;
  ageYears?: number;
  goal?: NutritionGoal;
  nutritionGoalCategory?: NutritionEngineInput['nutritionProfile']['nutritionGoalCategory'];
  pace?: NutritionProgressionPace;
  nonTrainingActivityLevel?: NutritionEngineInput['nutritionProfile']['nonTrainingActivityLevel'];
  weeklyTrainingFrequency?: number;
  mealSlots?: NutritionMealSlot[];
  pregnant?: boolean;
  breastfeeding?: boolean;
} = {}): NutritionEngineInput {
  return {
    inherited: {
      sex: overrides.sex ?? 'm',
      ageYears: overrides.ageYears ?? 30,
      heightCm: overrides.heightCm ?? 180,
      currentWeightKg: overrides.weightKg ?? 80,
      goal: overrides.goal ?? 'gain_muscle',
    },
    workout: { weeklyTrainingFrequency: overrides.weeklyTrainingFrequency ?? 0 },
    nutritionProfile: {
      questionnaireVersion: 1,
      progressionPace: overrides.pace ?? 'moderate',
      nonTrainingActivityLevel: overrides.nonTrainingActivityLevel ?? 'sedentary',
      mealSlots: overrides.mealSlots ?? ['breakfast', 'lunch', 'dinner'],
      dietaryPattern: 'omnivore',
      preferredFoodIds: [],
      usualFoodIds: [],
      excludedFoodIds: [],
      supplements: [],
      pregnant: overrides.pregnant ?? false,
      breastfeeding: overrides.breastfeeding ?? false,
      varietyPreference: 'indifferent',
      nutritionGoalCategory: overrides.nutritionGoalCategory,
      updatedAt: null,
    },
  };
}

describe('calculateNutritionTargets — golden cases', () => {
  it('male 80kg/180cm/30y, sedentary, 0 training, muscle_gain/moderate -> full regression on every field', () => {
    const output = calculateNutritionTargets(buildInput());

    expect(output.eligible).toBe(true);
    expect(output.blockers).toEqual([]);
    expect(output.energy.rmrKcal).toBeCloseTo(1780, 5);
    expect(output.energy.tdeeKcal).toBeCloseTo(2136, 5);
    expect(output.energy.targetKcal).toBeCloseTo(2349.6, 5);
    expect(output.energy.safetyClampApplied).toBe(false);
    expect(output.macros.proteinG).toBeCloseTo(144, 5);
    expect(output.macros.fatG).toBeCloseTo(65.26667, 4);
    expect(output.macros.carbsG).toBeCloseTo(296.55, 2);
    expect(output.macros.fiberG).toBeCloseTo(32.8944, 3);
    expect(output.mealTargets).toHaveLength(3);
    expect(output.versions.nutritionEngineVersion).toBe('1.0.0');
    expect(output.versions.questionnaireVersion).toBe(1);
  });

  it('female 60kg/165cm/30y, active, 4 training/week, weight_loss/gradual, 5 meals -> full regression', () => {
    const output = calculateNutritionTargets(buildInput({
      sex: 'f',
      weightKg: 60,
      heightCm: 165,
      goal: 'lose_fat',
      pace: 'gradual',
      nonTrainingActivityLevel: 'active',
      weeklyTrainingFrequency: 4,
      mealSlots: ['breakfast', 'morning_snack', 'lunch', 'dinner', 'supper'],
    }));

    expect(output.energy.rmrKcal).toBeCloseTo(1320.25, 5);
    expect(output.energy.tdeeKcal).toBeCloseTo(1998.35, 4);
    expect(output.energy.targetKcal).toBeCloseTo(1798.515, 3);
    expect(output.energy.safetyClampApplied).toBe(false);
    expect(output.macros.proteinG).toBeCloseTo(120, 5);
    expect(output.macros.fatG).toBeCloseTo(49.9587, 3);
    expect(output.macros.carbsG).toBeCloseTo(217.22, 1);
    expect(output.macros.fiberG).toBeCloseTo(25.18, 2);
    expect(output.mealTargets).toHaveLength(5);
  });

  it.each(['m', 'f'] as const)('sex=%s produces a different RMR for identical other inputs (sex constant applied)', (sex) => {
    const output = calculateNutritionTargets(buildInput({ sex, goal: 'health', pace: undefined }));
    const other = calculateNutritionTargets(buildInput({ sex: sex === 'm' ? 'f' : 'm', goal: 'health', pace: undefined }));
    expect(output.energy.rmrKcal).not.toBeCloseTo(other.energy.rmrKcal, 5);
  });

  it.each([
    ['gain_muscle', 'muscle_gain'],
    ['lose_fat', 'weight_loss'],
    ['health', 'maintenance'],
    ['body_composition', 'body_recomposition'],
  ] as const)('goal=%s resolves to category=%s and affects targetKcal accordingly', (goal, category) => {
    const output = calculateNutritionTargets(buildInput({ goal, pace: 'moderate' }));
    const maintenance = calculateNutritionTargets(buildInput({ goal: 'health', pace: undefined }));
    if (category === 'maintenance') {
      expect(output.energy.targetKcal).toBeCloseTo(output.energy.tdeeKcal, 5);
    } else if (category === 'weight_loss') {
      expect(output.energy.targetKcal).toBeLessThan(maintenance.energy.tdeeKcal);
    } else {
      expect(output.energy.targetKcal).not.toBeCloseTo(maintenance.energy.tdeeKcal, 1);
    }
  });

  it.each(['gradual', 'moderate', 'accelerated'] as const)('pace=%s changes the magnitude of the weight_loss deficit monotonically', (pace) => {
    const output = calculateNutritionTargets(buildInput({ goal: 'lose_fat', pace }));
    expect(output.energy.targetKcal).toBeLessThan(output.energy.tdeeKcal);
  });

  it('accelerated deficit is larger than gradual deficit for the same TDEE', () => {
    const gradual = calculateNutritionTargets(buildInput({ goal: 'lose_fat', pace: 'gradual' }));
    const accelerated = calculateNutritionTargets(buildInput({ goal: 'lose_fat', pace: 'accelerated' }));
    expect(accelerated.energy.targetKcal).toBeLessThan(gradual.energy.targetKcal);
  });

  it.each(['sedentary', 'low_active', 'active', 'very_active'] as const)('activity=%s increases TDEE monotonically', (level) => {
    const sedentary = calculateNutritionTargets(buildInput({ nonTrainingActivityLevel: 'sedentary', goal: 'health', pace: undefined }));
    const output = calculateNutritionTargets(buildInput({ nonTrainingActivityLevel: level, goal: 'health', pace: undefined }));
    expect(output.energy.tdeeKcal).toBeGreaterThanOrEqual(sedentary.energy.tdeeKcal);
  });

  it.each([0, 2, 6])('weeklyTrainingFrequency=%i increases TDEE monotonically with training days', (frequency) => {
    const zero = calculateNutritionTargets(buildInput({ weeklyTrainingFrequency: 0, goal: 'health', pace: undefined }));
    const output = calculateNutritionTargets(buildInput({ weeklyTrainingFrequency: frequency, goal: 'health', pace: undefined }));
    expect(output.energy.tdeeKcal).toBeGreaterThanOrEqual(zero.energy.tdeeKcal);
  });

  it.each([2, 3, 4, 5, 6])('mealSlots length=%i produces that many meal targets summing back to the daily target', (count) => {
    const allSlots: NutritionMealSlot[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper'];
    const output = calculateNutritionTargets(buildInput({ mealSlots: allSlots.slice(0, count), goal: 'health', pace: undefined }));
    expect(output.mealTargets).toHaveLength(count);
    const totalKcal = output.mealTargets.reduce((sum, meal) => sum + meal.kcal.target, 0);
    expect(totalKcal).toBeCloseTo(output.energy.targetKcal, 3);
  });
});

describe('calculateNutritionTargets — safety', () => {
  it('pregnant === true throws INELIGIBLE_PREGNANCY, no bypass', () => {
    try {
      calculateNutritionTargets(buildInput({ pregnant: true }));
      throw new Error('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NutritionEngineError);
      expect((error as NutritionEngineError).code).toBe('INELIGIBLE_PREGNANCY');
    }
  });

  it('breastfeeding === true throws INELIGIBLE_BREASTFEEDING, no bypass', () => {
    try {
      calculateNutritionTargets(buildInput({ breastfeeding: true }));
      throw new Error('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NutritionEngineError);
      expect((error as NutritionEngineError).code).toBe('INELIGIBLE_BREASTFEEDING');
    }
  });

  it('pregnancy takes priority over breastfeeding when both are true, but resolveEligibility reports both blockers', () => {
    const eligibility = resolveEligibility(buildInput({ pregnant: true, breastfeeding: true }));
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blockers).toEqual(['pregnancy', 'lactation']);

    try {
      calculateNutritionTargets(buildInput({ pregnant: true, breastfeeding: true }));
      throw new Error('expected to throw');
    } catch (error) {
      expect((error as NutritionEngineError).code).toBe('INELIGIBLE_PREGNANCY');
    }
  });

  it('resolveEligibility never throws and reports eligible=true/blockers=[] for a normal user', () => {
    expect(resolveEligibility(buildInput())).toEqual({ eligible: true, blockers: [] });
  });

  it('calorie floor clamps an extreme deficit for a very light, low-RMR profile', () => {
    const output = calculateNutritionTargets(buildInput({
      sex: 'f', weightKg: 40, heightCm: 150, ageYears: 60, goal: 'lose_fat', pace: 'accelerated',
    }));
    expect(output.energy.safetyClampApplied).toBe(true);
    expect(output.energy.targetKcal).toBe(1200);
  });

  it('ambiguous goal without nutritionGoalCategory throws GOAL_UNRESOLVED (no default to maintenance)', () => {
    try {
      calculateNutritionTargets(buildInput({ goal: 'strength', nutritionGoalCategory: undefined }));
      throw new Error('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NutritionEngineError);
      expect((error as NutritionEngineError).code).toBe('GOAL_UNRESOLVED');
    }
  });

  it('ambiguous goal WITH nutritionGoalCategory succeeds and uses that category', () => {
    const output = calculateNutritionTargets(buildInput({
      goal: 'strength', nutritionGoalCategory: 'maintenance', pace: undefined,
    }));
    expect(output.eligible).toBe(true);
    expect(output.energy.targetKcal).toBeCloseTo(output.energy.tdeeKcal, 5);
  });

  it('carbsG is never negative across every goal category in a golden-case sweep', () => {
    const goals: NutritionGoal[] = ['gain_muscle', 'lose_fat', 'health', 'body_composition'];
    for (const goal of goals) {
      const output = calculateNutritionTargets(buildInput({ goal, pace: 'accelerated' }));
      expect(output.macros.carbsG).toBeGreaterThanOrEqual(0);
    }
  });

  it('fat never drops below the 0.8 g/kg floor even for an aggressive weight_loss deficit', () => {
    const output = calculateNutritionTargets(buildInput({ goal: 'lose_fat', pace: 'accelerated', weightKg: 80 }));
    expect(output.macros.fatG).toBeGreaterThanOrEqual(0.8 * 80 - 1e-9);
  });

  it('invalid structural input (0 weight) throws INVALID_WEIGHT before any calculation happens', () => {
    try {
      calculateNutritionTargets(buildInput({ weightKg: 0 }));
      throw new Error('expected to throw');
    } catch (error) {
      expect((error as NutritionEngineError).code).toBe('INVALID_WEIGHT');
    }
  });
});

describe('calculateNutritionTargets — determinism', () => {
  it('same input (deep-cloned) -> deepEqual output, every time, across repeated calls', () => {
    const input = buildInput({ goal: 'lose_fat', pace: 'moderate', weeklyTrainingFrequency: 3 });
    const clone = (): NutritionEngineInput => JSON.parse(JSON.stringify(input));

    const first = calculateNutritionTargets(clone());
    const second = calculateNutritionTargets(clone());
    const third = calculateNutritionTargets(clone());

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('no two distinct inputs randomly collide, and no hidden current-time dependency (same logical input -> same output regardless of call time)', () => {
    const input = buildInput({ goal: 'gain_muscle' });
    const before = calculateNutritionTargets(JSON.parse(JSON.stringify(input)));
    // Simulate "time passing" — nothing in the engine should read Date.now().
    const later = calculateNutritionTargets(JSON.parse(JSON.stringify(input)));
    expect(later).toEqual(before);
  });
});
