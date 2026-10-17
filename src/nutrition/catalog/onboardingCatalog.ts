import type { NutritionFood } from '../../types/nutrition';
import rawSnapshot from './onboardingCatalog.json';
import { normalizeSearchText } from './normalize';
import type { CustomFoodInput } from '../../services/nutritionFoods';

const snapshot = rawSnapshot as unknown as { version: string; foods: (Pick<NutritionFood, 'id' | 'name' | 'aliases' | 'nutritionPer100g' | 'source'> & { searchPrefixes: string[] })[] };

export const ONBOARDING_CATALOG_VERSION = snapshot.version;
export const onboardingCatalogFoods = snapshot.foods;
export type OnboardingCustomFood = CustomFoodInput & { id: string };

/** Same normalized prefix membership, id ordering and bounded pages as Firestore search. */
export async function searchOnboardingCatalog(text: string, options: { cursor?: string } = {}) {
  const prefix = normalizeSearchText(text);
  if (prefix.length < 2 || prefix.length > 32) throw new Error('INVALID_CATALOG_SEARCH');
  const found = snapshot.foods.filter((food) => food.searchPrefixes.includes(prefix)
    && (!options.cursor || food.id > options.cursor));
  const foods = found.slice(0, 20);
  return { foods, nextCursor: found.length > 20 ? foods[foods.length - 1].id : null };
}
