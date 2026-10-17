/** Pure rollout contract shared by app and Functions. No Firebase dependency. */
export interface NutritionRolloutFlag { schemaVersion: 1; enabled: boolean; percentage: number }
export interface NutritionRolloutConfig {
  nutritionEnabled: NutritionRolloutFlag;
  nutritionPlanGenerationEnabled: NutritionRolloutFlag;
}
const OFF: NutritionRolloutFlag = { schemaVersion: 1, enabled: false, percentage: 0 };
export const NUTRITION_ROLLOUT_FAIL_SAFE_CONFIG: NutritionRolloutConfig = {
  nutritionEnabled: OFF, nutritionPlanGenerationEnabled: OFF,
};
function validFlag(value: unknown): value is NutritionRolloutFlag {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 3 && v.schemaVersion === 1 && typeof v.enabled === 'boolean'
    && typeof v.percentage === 'number' && Number.isInteger(v.percentage)
    && v.percentage >= 0 && v.percentage <= 100;
}
export function isValidNutritionRolloutConfig(value: unknown): value is NutritionRolloutConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && validFlag(v.nutritionEnabled)
    && validFlag(v.nutritionPlanGenerationEnabled);
}
export function nutritionRolloutBucket(uid: string, flag: keyof NutritionRolloutConfig): number {
  const value = `nutrition-rollout:${flag}:${uid}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}
export function nutritionFlagEnabled(uid: string, flag: keyof NutritionRolloutConfig, config: NutritionRolloutConfig): boolean {
  if (!isValidNutritionRolloutConfig(config)) return false;
  if (!config.nutritionEnabled.enabled || nutritionRolloutBucket(uid, 'nutritionEnabled') >= config.nutritionEnabled.percentage) return false;
  if (flag === 'nutritionEnabled') return true;
  return config[flag].enabled && nutritionRolloutBucket(uid, flag) < config[flag].percentage;
}

/** Separate document: old clients keep the exact two-flag `active` contract. Missing is OFF. */
export function onboardingAutomaticGenerationEnabled(uid: string, value: unknown): boolean {
  return validFlag(value) && value.enabled
    && nutritionRolloutBucket(uid, 'nutritionPlanGenerationEnabled') < value.percentage;
}
