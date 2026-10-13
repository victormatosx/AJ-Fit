import type { Firestore } from 'firebase-admin/firestore';
import { isValidNutritionRolloutConfig, nutritionFlagEnabled,
  nutritionRolloutBucket } from '../shared/nutrition/rolloutCore';
export { nutritionRolloutBucket };

export async function requireNutritionRollout(db: Firestore, uid: string): Promise<void> {
  const data: unknown = (await db.collection('nutritionRolloutConfig').doc('active').get()).data();
  if (!isValidNutritionRolloutConfig(data) || !nutritionFlagEnabled(uid, 'nutritionEnabled', data)) {
    throw new Error('NUTRITION_DISABLED');
  }
}

export async function requireNutritionGenerationRollout(db: Firestore, uid: string): Promise<void> {
  const data: unknown = (await db.collection('nutritionRolloutConfig').doc('active').get()).data();
  if (!isValidNutritionRolloutConfig(data)
    || !nutritionFlagEnabled(uid, 'nutritionEnabled', data)
    || !nutritionFlagEnabled(uid, 'nutritionPlanGenerationEnabled', data)) {
    throw new Error('NUTRITION_GENERATION_DISABLED');
  }
}
