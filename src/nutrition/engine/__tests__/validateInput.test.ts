import { describe, expect, it } from 'vitest';
import type { NutritionEngineInput } from '../../../types/nutrition';
import { NutritionEngineError } from '../errors';
import { validateNutritionEngineInput } from '../validateInput';

function baseInput(): NutritionEngineInput {
  return {
    inherited: { sex: 'm', ageYears: 30, heightCm: 180, currentWeightKg: 80, goal: 'gain_muscle' },
    workout: { weeklyTrainingFrequency: 3 },
    nutritionProfile: {
      questionnaireVersion: 1,
      progressionPace: 'moderate',
      nonTrainingActivityLevel: 'sedentary',
      mealSlots: ['breakfast', 'lunch', 'dinner'],
      dietaryPattern: 'omnivore',
      preferredFoodIds: [],
      usualFoodIds: [],
      excludedFoodIds: [],
      supplements: [],
      pregnant: false,
      breastfeeding: false,
      varietyPreference: 'indifferent',
      updatedAt: null,
    },
  };
}

function expectCode(input: NutritionEngineInput, code: string): void {
  try {
    validateNutritionEngineInput(input);
    throw new Error('expected validateNutritionEngineInput to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(NutritionEngineError);
    expect((error as NutritionEngineError).code).toBe(code);
  }
}

describe('validateNutritionEngineInput', () => {
  it('accepts a well-formed input without throwing', () => {
    expect(() => validateNutritionEngineInput(baseInput())).not.toThrow();
  });

  it('rejects weight <= 0', () => {
    const input = baseInput();
    input.inherited.currentWeightKg = 0;
    expectCode(input, 'INVALID_WEIGHT');
  });

  it('accepts weight just above 0 (boundary)', () => {
    const input = baseInput();
    input.inherited.currentWeightKg = 0.01;
    expect(() => validateNutritionEngineInput(input)).not.toThrow();
  });

  it('rejects height <= 0', () => {
    const input = baseInput();
    input.inherited.heightCm = 0;
    expectCode(input, 'INVALID_HEIGHT');
  });

  it('rejects implausible age (too young)', () => {
    const input = baseInput();
    input.inherited.ageYears = 9.99;
    expectCode(input, 'INVALID_AGE');
  });

  it('accepts age at the plausible lower boundary (10)', () => {
    const input = baseInput();
    input.inherited.ageYears = 10;
    expect(() => validateNutritionEngineInput(input)).not.toThrow();
  });

  it('rejects implausible age (too old)', () => {
    const input = baseInput();
    input.inherited.ageYears = 100.01;
    expectCode(input, 'INVALID_AGE');
  });

  it('accepts age at the plausible upper boundary (100)', () => {
    const input = baseInput();
    input.inherited.ageYears = 100;
    expect(() => validateNutritionEngineInput(input)).not.toThrow();
  });

  it('rejects negative weekly training frequency', () => {
    const input = baseInput();
    input.workout.weeklyTrainingFrequency = -1;
    expectCode(input, 'INVALID_TRAINING_FREQUENCY');
  });

  it('accepts weekly training frequency of exactly 0', () => {
    const input = baseInput();
    input.workout.weeklyTrainingFrequency = 0;
    expect(() => validateNutritionEngineInput(input)).not.toThrow();
  });

  it('rejects fewer than 2 meal slots', () => {
    const input = baseInput();
    input.nutritionProfile.mealSlots = ['breakfast'];
    expectCode(input, 'INVALID_MEAL_SLOT_COUNT');
  });

  it('accepts exactly 2 meal slots (boundary)', () => {
    const input = baseInput();
    input.nutritionProfile.mealSlots = ['breakfast', 'dinner'];
    expect(() => validateNutritionEngineInput(input)).not.toThrow();
  });

  it('accepts exactly 6 meal slots (boundary)', () => {
    const input = baseInput();
    input.nutritionProfile.mealSlots = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper'];
    expect(() => validateNutritionEngineInput(input)).not.toThrow();
  });

  it('rejects more than 6 meal slots', () => {
    const input = baseInput();
    input.nutritionProfile.mealSlots = [
      'breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper', 'breakfast',
    ];
    expectCode(input, 'INVALID_MEAL_SLOT_COUNT');
  });

  it('rejects duplicate meal slots', () => {
    const input = baseInput();
    input.nutritionProfile.mealSlots = ['breakfast', 'breakfast'];
    expectCode(input, 'INVALID_MEAL_SLOT_VALUE');
  });
});
