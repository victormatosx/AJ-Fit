import type { Firestore } from 'firebase-admin/firestore';

/**
 * Diet-quality-v3 (2026-10-10): the ONLY remaining read of `nutritionFoods`
 * from the generation pipeline — a plain id->name lookup so the prompt can
 * show the user's preferred/usual/excluded foods BY NAME instead of an
 * opaque catalog id. Purely for prompt display: it never gates, filters, or
 * blocks generation — a missing/unresolved id is silently dropped, never an
 * error.
 */
export async function resolveFoodNames(db: Firestore, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const docs = await Promise.all(unique.map((id) => db.collection('nutritionFoods').doc(id).get()));
  const names = new Map<string, string>();
  for (const doc of docs) {
    const name = doc.data()?.name;
    if (typeof name === 'string' && name.length > 0) names.set(doc.id, name);
  }
  return names;
}

export interface NutritionPromptFoodNames {
  preferred: string[];
  usual: string[];
  excluded: string[];
}

export async function resolvePromptFoodNames(
  db: Firestore, profile: { preferredFoodIds: readonly string[]; usualFoodIds: readonly string[]; excludedFoodIds: readonly string[] },
): Promise<NutritionPromptFoodNames> {
  const names = await resolveFoodNames(db, [...profile.preferredFoodIds, ...profile.usualFoodIds, ...profile.excludedFoodIds]);
  const resolve = (ids: readonly string[]) => ids.map((id) => names.get(id)).filter((name): name is string => Boolean(name));
  return { preferred: resolve(profile.preferredFoodIds), usual: resolve(profile.usualFoodIds), excluded: resolve(profile.excludedFoodIds) };
}
