import type { NutritionGoal, NutritionGoalCategory, NutritionProfile } from '../../types/nutrition';
import { NUTRITION_GOAL_CATEGORY_MAP } from '../../types/nutrition';
import { NutritionEngineError } from './errors';

/**
 * Implements the approved resolution rule exactly
 * (`docs/nutrition/03_nutrition_engine/goals_and_adjustments.md` §1.3):
 *
 * ```text
 * if NUTRITION_GOAL_CATEGORY_MAP[goal] != null: use the mapped value
 * if NUTRITION_GOAL_CATEGORY_MAP[goal] == null: require nutritionProfile.nutritionGoalCategory
 * ```
 *
 * Never falls back to a default category — throws `GOAL_UNRESOLVED` when
 * the goal is ambiguous and `nutritionGoalCategory` was not supplied.
 */
export function resolveGoalCategory(
  goal: NutritionGoal,
  nutritionProfile: Pick<NutritionProfile, 'nutritionGoalCategory'>,
): NutritionGoalCategory {
  const direct = NUTRITION_GOAL_CATEGORY_MAP[goal];
  if (direct != null) return direct;

  if (nutritionProfile.nutritionGoalCategory != null) {
    return nutritionProfile.nutritionGoalCategory;
  }

  throw new NutritionEngineError(
    'GOAL_UNRESOLVED',
    `Goal "${goal}" has no direct nutrition category mapping and nutritionProfile.nutritionGoalCategory was not provided.`,
  );
}
