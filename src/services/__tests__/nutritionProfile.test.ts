import { describe, expect, it, vi } from 'vitest';
import { serializeNutritionProfileAnswers, validateNutritionProfileAnswers } from '../nutritionProfile';

vi.mock('../../lib/firebase', () => ({ db: {} }));

const answers = () => ({ questionnaireVersion: 1, nonTrainingActivityLevel: 'active' as const,
  mealSlots: ['breakfast', 'lunch'] as ('breakfast' | 'lunch')[], dietaryPattern: 'omnivore' as const,
  preferredFoodIds: ['rice'], usualFoodIds: [], excludedFoodIds: [], supplements: [],
  pregnant: false, breastfeeding: false, varietyPreference: 'variety' as const });

describe('Nutrition profile serialization', () => {
  it('serializes only nutrition answers with a write timestamp and does not alias arrays', () => {
    const input = answers();
    const output = serializeNutritionProfileAnswers(input);
    expect(output).toMatchObject({ questionnaireVersion: 1, pregnant: false, preferredFoodIds: ['rice'] });
    expect(output).toHaveProperty('updatedAt');
    input.preferredFoodIds.push('beans');
    expect(output.preferredFoodIds).toEqual(['rice']);
    expect(output).not.toHaveProperty('weight');
  });
  it('rejects extra physical fields and invalid bounds before writing', () => {
    expect(() => validateNutritionProfileAnswers({ ...answers(), weight: 70 })).toThrow();
    expect(() => validateNutritionProfileAnswers({ ...answers(), mealSlots: ['lunch'] })).toThrow();
    expect(() => validateNutritionProfileAnswers({ ...answers(), preferredFoodIds: Array.from({ length: 11 }, (_, i) => `f${i}`) })).toThrow();
    expect(() => validateNutritionProfileAnswers({ ...answers(), nutritionGoalCategory: 'unknown' })).toThrow();
  });
});
