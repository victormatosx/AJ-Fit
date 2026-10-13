import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BODY_RECOMPOSITION_DEFICIT_PERCENTAGE,
  DEFICIT_PERCENTAGE_BY_PACE,
  ENERGY_WEIGHT_BY_MEAL_CATEGORY,
  FAT_MAX_PERCENT_OF_CALORIES,
  FAT_MIN_G_PER_KG,
  FAT_TARGET_PERCENT_OF_CALORIES,
  FIBER_G_PER_1000_KCAL,
  MEAL_SLOT_CATEGORY,
  MINIMUM_CALORIES_BY_SEX,
  NON_TRAINING_ACTIVITY_FACTOR,
  PROTEIN_RANGE_BY_GOAL_CATEGORY,
  PROTEIN_WEIGHT_BY_MEAL_CATEGORY,
  SURPLUS_PERCENTAGE_BY_PACE,
  TOLERANCE_PERCENT,
  TRAINING_SESSION_MET,
  TRAINING_SESSION_MINUTES,
} from '../constants';

/** Regression guard: these TS constants must never silently drift from the closed, cited values in canonical/nutrition_rules.json. */

type RulesFile = {
  energy: {
    tdeeStrategy: {
      nonTrainingActivityFactor: Record<string, number>;
      trainingSessionKcal: { trainingMet: number; trainingSessionMinutes: number };
    };
  };
  goals: {
    deficitPercentages: { values: Record<string, number> };
    surplusPercentages: { values: Record<string, number> };
    bodyRecompositionRule: { value: { deficitPercentageOfTdee: number } };
  };
  safety: { minimumCaloriesBySex: { values: Record<string, number> } };
  macros: {
    protein: { rangesByGoal: { values: Record<string, { minGPerKg: number; targetGPerKg: number; maxGPerKg: number }> } };
    fat: { ranges: { values: { minGPerKg: number; targetPercentOfCalories: number; maxPercentOfCalories: number } } };
    fiber: { target: { value: number } };
  };
  mealDistribution: {
    distributionWeights: {
      mealSlotCategory: Record<string, string>;
      energyWeightByCategory: Record<string, number>;
      proteinWeightByCategory: Record<string, number>;
    };
  };
  tolerances: Record<string, { percent: number } | string>;
};

const rules: RulesFile = JSON.parse(readFileSync('docs/nutrition/canonical/nutrition_rules.json', 'utf8'));

describe('engine constants match canonical/nutrition_rules.json exactly', () => {
  it('nonTrainingActivityFactor', () => {
    const { source: _source, ...values } = rules.energy.tdeeStrategy.nonTrainingActivityFactor as Record<string, number | string>;
    expect(NON_TRAINING_ACTIVITY_FACTOR).toEqual(values);
  });

  it('trainingSessionMet / trainingSessionMinutes', () => {
    expect(TRAINING_SESSION_MET).toBe(rules.energy.tdeeStrategy.trainingSessionKcal.trainingMet);
    expect(TRAINING_SESSION_MINUTES).toBe(rules.energy.tdeeStrategy.trainingSessionKcal.trainingSessionMinutes);
  });

  it('deficitPercentageByPace', () => {
    expect(DEFICIT_PERCENTAGE_BY_PACE).toEqual(rules.goals.deficitPercentages.values);
  });

  it('surplusPercentageByPace', () => {
    expect(SURPLUS_PERCENTAGE_BY_PACE).toEqual(rules.goals.surplusPercentages.values);
  });

  it('bodyRecompositionDeficitPercentage', () => {
    expect(BODY_RECOMPOSITION_DEFICIT_PERCENTAGE).toBe(rules.goals.bodyRecompositionRule.value.deficitPercentageOfTdee);
  });

  it('minimumCaloriesBySex', () => {
    expect(MINIMUM_CALORIES_BY_SEX).toEqual({ m: rules.safety.minimumCaloriesBySex.values.male, f: rules.safety.minimumCaloriesBySex.values.female });
  });

  it('proteinRangeByGoalCategory', () => {
    expect(PROTEIN_RANGE_BY_GOAL_CATEGORY).toEqual(rules.macros.protein.rangesByGoal.values);
  });

  it('fat min/target/max', () => {
    const fat = rules.macros.fat.ranges.values;
    expect(FAT_MIN_G_PER_KG).toBe(fat.minGPerKg);
    expect(FAT_TARGET_PERCENT_OF_CALORIES).toBe(fat.targetPercentOfCalories);
    expect(FAT_MAX_PERCENT_OF_CALORIES).toBe(fat.maxPercentOfCalories);
  });

  it('fiberGPer1000Kcal', () => {
    expect(FIBER_G_PER_1000_KCAL).toBe(rules.macros.fiber.target.value);
  });

  it('mealSlotCategory / energy and protein weights', () => {
    expect(MEAL_SLOT_CATEGORY).toEqual(rules.mealDistribution.distributionWeights.mealSlotCategory);
    expect(ENERGY_WEIGHT_BY_MEAL_CATEGORY).toEqual(rules.mealDistribution.distributionWeights.energyWeightByCategory);
    expect(PROTEIN_WEIGHT_BY_MEAL_CATEGORY).toEqual(rules.mealDistribution.distributionWeights.proteinWeightByCategory);
  });

  it('tolerancePercent', () => {
    expect(TOLERANCE_PERCENT.calories).toBe((rules.tolerances.calories as { percent: number }).percent);
    expect(TOLERANCE_PERCENT.protein).toBe((rules.tolerances.protein as { percent: number }).percent);
    expect(TOLERANCE_PERCENT.carbohydrates).toBe((rules.tolerances.carbohydrates as { percent: number }).percent);
    expect(TOLERANCE_PERCENT.fat).toBe((rules.tolerances.fat as { percent: number }).percent);
    expect(TOLERANCE_PERCENT.fiber).toBe((rules.tolerances.fiber as { percent: number }).percent);
  });
});
