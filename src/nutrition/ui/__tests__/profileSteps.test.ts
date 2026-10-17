import { describe, expect, it } from 'vitest';
import {
  canContinueProfileStep, isProfileDraftComplete, needsNutritionGoalCategory, parseTargetWeightInput,
  profileStepOrder, profileDraftFromSaved, toggleDietaryPattern, type ProfileDraft,
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

  it('treats optional fields as always continuable', () => {
    for (const step of ['targetWeightKg', 'preferredFoodIds', 'excludedFoodIds', 'excludedAllergens', 'supplements'] as const) {
      expect(canContinueProfileStep(step, {}, 'health')).toBe(true);
    }
  });

  it('requires nonTrainingActivityLevel', () => {
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
    expect(isProfileDraftComplete('strength', { ...BASE_DRAFT, nutritionGoalCategory: 'muscle_gain', progressionPace: 'gradual' })).toBe(true);
    expect(isProfileDraftComplete('health', BASE_DRAFT)).toBe(true);
  });
});

describe('refactored questionnaire compatibility', () => {
  it('uses nine steps and removes obsolete pages from progress and back navigation', () => {
    expect(profileStepOrder('health')).toEqual(['progressionPace', 'targetWeightKg', 'nonTrainingActivityLevel',
      'mealSlots', 'preferredFoodIds', 'excludedFoodIds', 'excludedAllergens', 'supplements', 'varietyPreference']);
    expect(profileStepOrder('strength')).toHaveLength(10);
  });
  it('allows no pattern and mutually exclusive, deselectable patterns', () => {
    expect(isProfileDraftComplete('health', { ...BASE_DRAFT, dietaryPattern: undefined })).toBe(true);
    expect(toggleDietaryPattern(undefined, 'vegetarian')).toBe('vegetarian');
    expect(toggleDietaryPattern('vegetarian', 'vegan')).toBe('vegan');
    expect(toggleDietaryPattern('vegan', 'pescatarian')).toBe('pescatarian');
    expect(toggleDietaryPattern('pescatarian', 'pescatarian')).toBe('omnivore');
  });
  it('preserves historical foods and positive safety flags without sending updatedAt on edit', () => {
    const saved = { ...BASE_DRAFT, usualFoodIds: ['rice'], pregnant: true, updatedAt: 'timestamp' };
    const draft = profileDraftFromSaved(saved as import('../../../types/nutrition').NutritionProfile);
    expect(draft).not.toHaveProperty('updatedAt');
    expect(draft.usualFoodIds).toEqual(['rice']);
    expect(draft.pregnant).toBe(true);
    expect(isProfileDraftComplete('health', draft)).toBe(true);
  });
});

describe('target weight editing', () => {
  it.each(['70,5', '70.5'])('accepts decimal input %s and keeps kilograms canonical', (text) => {
    const targetWeightKg = parseTargetWeightInput(text, 'metric');
    expect(targetWeightKg).toBe(70.5);
    expect(canContinueProfileStep('targetWeightKg', { targetWeightKg })).toBe(true);
  });
  it('converts displayed pounds to kg', () => {
    expect(parseTargetWeightInput('180', 'imperial')).toBeCloseTo(81.6466, 4);
  });
  it('allows clearing or explicitly skipping a previously saved target', () => {
    expect(parseTargetWeightInput('', 'metric')).toBeNull();
    expect(canContinueProfileStep('targetWeightKg', { targetWeightKg: null })).toBe(true);
  });
  it.each(['0', '-2', '501', 'NaN', 'Infinity', '80kg', '70,5,2'])('blocks invalid target %s instead of silently skipping it', (text) => {
    const targetWeightKg = parseTargetWeightInput(text, 'metric');
    expect(canContinueProfileStep('targetWeightKg', { targetWeightKg })).toBe(false);
    expect(isProfileDraftComplete('health', { ...BASE_DRAFT, targetWeightKg })).toBe(false);
  });
  it('keeps existing targets editable without metadata and preserves the upper bound', () => {
    expect(canContinueProfileStep('targetWeightKg', { targetWeightKg: 500 })).toBe(true);
    const saved = { ...BASE_DRAFT, targetWeightKg: 67.5, updatedAt: null };
    expect(profileDraftFromSaved(saved as import('../../../types/nutrition').NutritionProfile).targetWeightKg).toBe(67.5);
  });
});

describe('pace matches existing energy rules', () => {
  it('requires pace only for loss and gain, including resolved ambiguous goals', () => {
    expect(isProfileDraftComplete('lose_fat', BASE_DRAFT)).toBe(false);
    expect(isProfileDraftComplete('gain_muscle', { ...BASE_DRAFT, progressionPace: 'moderate' })).toBe(true);
    expect(isProfileDraftComplete('health', BASE_DRAFT)).toBe(true);
    expect(isProfileDraftComplete('body_composition', BASE_DRAFT)).toBe(true);
    expect(isProfileDraftComplete('strength', { ...BASE_DRAFT, nutritionGoalCategory: 'muscle_gain' })).toBe(false);
  });
});
