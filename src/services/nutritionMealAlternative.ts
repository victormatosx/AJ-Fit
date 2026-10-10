import { httpsCallable } from 'firebase/functions';
import { randomUUID } from 'expo-crypto';
import { doc, getDoc, type Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { functions } from '../lib/firebaseFunctions';
import type { NutritionMealAlternative, NutritionMealFeedbackReason, NutritionMealSlot } from '../types/nutrition';

const REQUEST_NUTRITION_MEAL_ALTERNATIVE_CALLABLE = 'requestNutritionMealAlternative';

export interface RequestNutritionMealAlternativeInput {
  requestId?: string;
  planId: string;
  slot: NutritionMealSlot;
  feedback?: { reason: NutritionMealFeedbackReason; dislikedFoodIds?: string[] };
}
export interface RequestNutritionMealAlternativeResult {
  alternativeId: string;
  options: NutritionMealAlternative['options'];
  recommendedOptionId: string;
}

/** The ONLY client entry point into meal-alternative generation — same validator/correction authority as a full plan, scoped to one meal (round brief §11). */
export async function requestNutritionMealAlternative(
  input: RequestNutritionMealAlternativeInput,
): Promise<RequestNutritionMealAlternativeResult> {
  const callable = httpsCallable<RequestNutritionMealAlternativeInput & { requestId: string }, RequestNutritionMealAlternativeResult>(
    functions, REQUEST_NUTRITION_MEAL_ALTERNATIVE_CALLABLE,
  );
  return (await callable({ ...input, requestId: input.requestId ?? randomUUID() })).data;
}

export async function loadNutritionMealAlternative(
  uid: string, alternativeId: string,
): Promise<NutritionMealAlternative<Timestamp> | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'nutritionMealAlternatives', alternativeId));
  return snap.exists() ? snap.data() as NutritionMealAlternative<Timestamp> : null;
}
