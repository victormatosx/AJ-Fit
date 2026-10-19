import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';

/** Resolve catalog IDs to names. Missing inclusion preferences may be ignored;
 * an unresolved hard exclusion blocks generation before contacting AI. */
export async function resolveFoodNames(db: Firestore, ids: readonly string[], uid?: string): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const docs = await Promise.all(unique.map((id) => (id.startsWith('custom_') && uid
    ? db.collection('users').doc(uid).collection('nutritionFoods').doc(id)
    : db.collection(id.startsWith('flc_') ? 'foodLogCatalog' : 'nutritionFoods').doc(id)).get()));
  const names = new Map<string, string>();
  for (const doc of docs) {
    const name = doc.data()?.name;
    if (typeof name === 'string' && name.trim().length > 0) names.set(doc.id, name.trim());
  }
  return names;
}

export interface NutritionPromptFoodNames {
  preferred: string[];
  usual: string[];
  excluded: string[];
}

export async function resolvePromptFoodNames(
  db: Firestore, profile: { preferredFoodIds: readonly string[]; usualFoodIds: readonly string[]; excludedFoodIds: readonly string[] }, uid?: string,
): Promise<NutritionPromptFoodNames> {
  const names = await resolveFoodNames(db, [...profile.preferredFoodIds, ...profile.usualFoodIds, ...profile.excludedFoodIds], uid);
  const resolve = (ids: readonly string[]) => ids.map((id) => names.get(id)).filter((name): name is string => Boolean(name));
  if (profile.excludedFoodIds.some((id) => !names.has(id))) {
    throw new HttpsError('failed-precondition', 'INVALID_NUTRITION_PROFILE');
  }
  return { preferred: resolve(profile.preferredFoodIds), usual: resolve(profile.usualFoodIds), excluded: resolve(profile.excludedFoodIds) };
}
