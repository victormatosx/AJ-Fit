import { describe, expect, it, vi } from 'vitest';
import { isValidNutritionRolloutConfig, nutritionFlagEnabled, nutritionRolloutBucket,
  NUTRITION_ROLLOUT_FAIL_SAFE_CONFIG, onboardingAutomaticGenerationEnabled, subscribeToNutritionRolloutConfig } from '../rollout';

const snapshots = vi.hoisted(() => vi.fn());
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), onSnapshot: snapshots }));

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

it('recovers gates from an empty offline snapshot when the server config arrives', () => {
  const unsubscribe = vi.fn(); snapshots.mockReturnValue(unsubscribe);
  const configs = vi.fn();
  const stop = subscribeToNutritionRolloutConfig(configs);
  const [, next, error] = snapshots.mock.calls[0];
  next({ data: () => undefined });
  expect(configs).toHaveBeenLastCalledWith(NUTRITION_ROLLOUT_FAIL_SAFE_CONFIG);
  const config = { nutritionEnabled: enabled, nutritionPlanGenerationEnabled: enabled };
  next({ data: () => config });
  expect(nutritionFlagEnabled('u', 'nutritionPlanGenerationEnabled', configs.mock.calls.at(-1)![0])).toBe(true);
  error(new Error('denied'));
  expect(configs).toHaveBeenLastCalledWith(NUTRITION_ROLLOUT_FAIL_SAFE_CONFIG);
  stop(); expect(unsubscribe).toHaveBeenCalledOnce();
});

it('keeps automatic generation independently disabled without changing the historical active contract', () => {
  const legacy = { nutritionEnabled: enabled, nutritionPlanGenerationEnabled: enabled };
  expect(isValidNutritionRolloutConfig(legacy)).toBe(true);
  expect(nutritionFlagEnabled('u', 'nutritionPlanGenerationEnabled', legacy)).toBe(true);
  expect(onboardingAutomaticGenerationEnabled('u', undefined)).toBe(false);
  expect(onboardingAutomaticGenerationEnabled('u', { ...enabled, enabled: false })).toBe(false);
  expect(onboardingAutomaticGenerationEnabled('u', enabled)).toBe(true);
});
