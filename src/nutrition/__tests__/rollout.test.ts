import { describe, expect, it, vi } from 'vitest';
import { isValidNutritionRolloutConfig, nutritionFlagEnabled, nutritionRolloutBucket,
  NUTRITION_ROLLOUT_FAIL_SAFE_CONFIG } from '../rollout';

vi.mock('../../lib/firebase', () => ({ db: {} }));

const enabled = { schemaVersion: 1 as const, enabled: true, percentage: 100 };
describe('Nutrition rollout', () => {
  it('defaults off and rejects malformed config', () => {
    expect(nutritionFlagEnabled('alice', 'nutritionEnabled', NUTRITION_ROLLOUT_FAIL_SAFE_CONFIG)).toBe(false);
    expect(isValidNutritionRolloutConfig({ nutritionEnabled: enabled })).toBe(false);
  });
  it('has a stable bucket and gates generation behind global Nutrition', () => {
    expect(nutritionRolloutBucket('alice', 'nutritionEnabled')).toBe(nutritionRolloutBucket('alice', 'nutritionEnabled'));
    expect(nutritionFlagEnabled('alice', 'nutritionPlanGenerationEnabled', {
      nutritionEnabled: { ...enabled, enabled: false }, nutritionPlanGenerationEnabled: enabled,
    })).toBe(false);
    expect(nutritionFlagEnabled('alice', 'nutritionPlanGenerationEnabled', {
      nutritionEnabled: enabled, nutritionPlanGenerationEnabled: enabled,
    })).toBe(true);
  });
});
