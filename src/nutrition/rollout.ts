import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isValidNutritionRolloutConfig, NUTRITION_ROLLOUT_FAIL_SAFE_CONFIG,
  type NutritionRolloutConfig } from './rolloutCore';
export * from './rolloutCore';

/** Keeps gates current after an offline cold start, using Firestore's reconnecting listener. */
export function subscribeToNutritionRolloutConfig(onConfig: (config: NutritionRolloutConfig) => void) {
  return onSnapshot(doc(db, 'nutritionRolloutConfig', 'active'), (snapshot) => {
    const data: unknown = snapshot.data();
    onConfig(isValidNutritionRolloutConfig(data) ? data : NUTRITION_ROLLOUT_FAIL_SAFE_CONFIG);
  }, () => onConfig(NUTRITION_ROLLOUT_FAIL_SAFE_CONFIG));
}

export async function loadNutritionRolloutConfig(): Promise<NutritionRolloutConfig> {
  try {
    const snapshot = await getDoc(doc(db, 'nutritionRolloutConfig', 'active'));
    const data: unknown = snapshot.data();
    return isValidNutritionRolloutConfig(data) ? data : NUTRITION_ROLLOUT_FAIL_SAFE_CONFIG;
  } catch {
    return NUTRITION_ROLLOUT_FAIL_SAFE_CONFIG;
  }
}

export async function loadOnboardingAutomaticGenerationFlag(): Promise<unknown> {
  try { return (await getDoc(doc(db, 'nutritionRolloutConfig', 'onboardingAutomatic'))).data(); }
  catch { return null; }
}
