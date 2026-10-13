import { describe, expect, it } from 'vitest';
import {
  canContinueProfileStep, isProfileDraftComplete, isSafetyBlocked, needsNutritionGoalCategory,
  profileStepOrder, type ProfileDraft,
} from '../profileSteps';

const BASE_DRAFT: ProfileDraft = {
  questionnaireVersion: 1,
  nonTrainingActivityLevel: 'active',
  mealSlots: ['breakfast', 'lunch'],
  dietaryPattern: 'omnivore',
  preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [], excludedAllergens: [], supplements: [],
  pregnant: false, breastfeeding: false, varietyPreference: 'indifferent',
};

describe('needsNutritionGoalCategory', () => {
  it('is true only for goals with no direct category mapping', () => {
    expect(needsNutritionGoalCategory('strength')).toBe(true);
    expect(needsNutritionGoalCategory('conditioning')).toBe(true);
    expect(needsNutritionGoalCategory('perf')).toBe(true);
    expect(needsNutritionGoalCategory('return_to_training')).toBe(true);
    expect(needsNutritionGoalCategory('recon')).toBe(true);
    expect(needsNutritionGoalCategory('gain_muscle')).toBe(false);
    expect(needsNutritionGoalCategory('lose_fat')).toBe(false);
    expect(needsNutritionGoalCategory('health')).toBe(false);
  });
});

describe('profileStepOrder', () => {
  it('prepends nutritionGoalCategory only for ambiguous goals', () => {
    expect(profileStepOrder('strength')[0]).toBe('nutritionGoalCategory');
    expect(profileStepOrder('gain_muscle')[0]).not.toBe('nutritionGoalCategory');
    expect(profileStepOrder('gain_muscle')).not.toContain('nutritionGoalCategory');
  });

  it('never re-asks inherited fields (sex/height/birthDate/weight/goal)', () => {
    const steps = profileStepOrder('strength');
    for (const inherited of ['sex', 'height', 'birthDate', 'weight', 'goal']) {
      expect(steps).not.toContain(inherited);
    }
  });
});

describe('canContinueProfileStep', () => {
  it('gates mealSlots to 2-6 unique entries', () => {
    expect(canContinueProfileStep('mealSlots', { mealSlots: [] })).toBe(false);
    expect(canContinueProfileStep('mealSlots', { mealSlots: ['breakfast'] })).toBe(false);
    expect(canContinueProfileStep('mealSlots', { mealSlots: ['breakfast', 'lunch'] })).toBe(true);
    expect(canContinueProfileStep('mealSlots', {
      mealSlots: ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper'],
    })).toBe(true);
  });

  it('requires an explicit boolean for pregnant/breastfeeding, not just truthy', () => {
    expect(canContinueProfileStep('pregnant', {})).toBe(false);
    expect(canContinueProfileStep('pregnant', { pregnant: false })).toBe(true);
    expect(canContinueProfileStep('pregnant', { pregnant: true })).toBe(true);
    expect(canContinueProfileStep('breastfeeding', {})).toBe(false);
    expect(canContinueProfileStep('breastfeeding', { breastfeeding: false })).toBe(true);
  });

  it('treats optional fields as always continuable', () => {
    for (const step of ['targetWeightKg', 'preferredFoodIds', 'usualFoodIds', 'excludedFoodIds', 'excludedAllergens', 'supplements'] as const) {
      expect(canContinueProfileStep(step, {})).toBe(true);
    }
  });

  it('requires dietaryPattern and nonTrainingActivityLevel', () => {
    expect(canContinueProfileStep('dietaryPattern', {})).toBe(false);
    expect(canContinueProfileStep('dietaryPattern', { dietaryPattern: 'vegan' })).toBe(true);
    expect(canContinueProfileStep('nonTrainingActivityLevel', {})).toBe(false);
    expect(canContinueProfileStep('nonTrainingActivityLevel', { nonTrainingActivityLevel: 'sedentary' })).toBe(true);
  });
});

describe('isProfileDraftComplete', () => {
  it('is false while a required field is missing and true once the whole flow is answered', () => {
    expect(isProfileDraftComplete('health', {})).toBe(false);
    expect(isProfileDraftComplete('health', BASE_DRAFT)).toBe(true);
  });

  it('requires nutritionGoalCategory only for ambiguous goals', () => {
    expect(isProfileDraftComplete('strength', BASE_DRAFT)).toBe(false);
    expect(isProfileDraftComplete('strength', { ...BASE_DRAFT, nutritionGoalCategory: 'muscle_gain' })).toBe(true);
    expect(isProfileDraftComplete('health', BASE_DRAFT)).toBe(true);
  });
});

describe('isSafetyBlocked', () => {
  it('blocks when pregnant or breastfeeding is explicitly true, never on absence', () => {
    expect(isSafetyBlocked({})).toBe(false);
    expect(isSafetyBlocked({ pregnant: false, breastfeeding: false })).toBe(false);
    expect(isSafetyBlocked({ pregnant: true })).toBe(true);
    expect(isSafetyBlocked({ breastfeeding: true })).toBe(true);
  });
});
