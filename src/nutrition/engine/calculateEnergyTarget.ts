import type { NutritionGoalCategory, NutritionProgressionPace, Sex } from '../../types/nutrition';
import {
  BODY_RECOMPOSITION_DEFICIT_PERCENTAGE,
  DEFICIT_PERCENTAGE_BY_PACE,
  MINIMUM_CALORIES_BY_SEX,
  SURPLUS_PERCENTAGE_BY_PACE,
} from './constants';
import { NutritionEngineError } from './errors';

export interface EnergyTargetResult {
  targetKcal: number;
  safetyClampApplied: boolean;
}

/**
 * Goal adjustment (`canonical/nutrition_rules.json` `goals.*Percentages`/
 * `bodyRecompositionRule`) followed by the safety-floor clamp
 * (`safety.minimumCaloriesBySex`) — clamp is always applied AFTER the goal
 * adjustment, never before, so the AI can never be handed a pre-clamped
 * "budget" to work around.
 */
export function calculateEnergyTarget(
  tdeeKcal: number,
  goalCategory: NutritionGoalCategory,
  pace: NutritionProgressionPace | undefined,
  sex: Sex,
): EnergyTargetResult {
  const preClampKcal = applyGoalAdjustment(tdeeKcal, goalCategory, pace);

  const floorKcal = MINIMUM_CALORIES_BY_SEX[sex];
  const safetyClampApplied = preClampKcal < floorKcal;
  const targetKcal = safetyClampApplied ? floorKcal : preClampKcal;

  return { targetKcal, safetyClampApplied };
}

function applyGoalAdjustment(
  tdeeKcal: number,
  goalCategory: NutritionGoalCategory,
  pace: NutritionProgressionPace | undefined,
): number {
  switch (goalCategory) {
    case 'weight_loss':
      return tdeeKcal * (1 - DEFICIT_PERCENTAGE_BY_PACE[requirePace(pace, goalCategory)]);
    case 'muscle_gain':
      return tdeeKcal * (1 + SURPLUS_PERCENTAGE_BY_PACE[requirePace(pace, goalCategory)]);
    case 'maintenance':
      return tdeeKcal;
    case 'body_recomposition':
      // Deliberately pace-independent — see goals_and_adjustments.md §2.1.
      return tdeeKcal * (1 - BODY_RECOMPOSITION_DEFICIT_PERCENTAGE);
    default: {
      const exhaustiveCheck: never = goalCategory;
      throw new Error(`Unhandled NutritionGoalCategory: ${exhaustiveCheck}`);
    }
  }
}

function requirePace(
  pace: NutritionProgressionPace | undefined,
  goalCategory: 'weight_loss' | 'muscle_gain',
): NutritionProgressionPace {
  if (pace == null) {
    throw new NutritionEngineError(
      'PROGRESSION_PACE_REQUIRED',
      `nutritionProfile.progressionPace is required when the resolved goal category is "${goalCategory}".`,
    );
  }
  return pace;
}
