import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query,
  runTransaction, serverTimestamp, setDoc, type Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { NutritionFavoriteMealOption, NutritionFoodNutritionValues, NutritionPreferences } from '../types/nutrition';
import { loadCatalogFood, loadCustomFood } from './nutritionFoods';
import { loadFoodLogEntry } from './foodLogCatalog';
import { calculateStoredRecipeBreakdown, loadNutritionRecipe } from './nutritionRecipes';
import type { RecipeNutritionBreakdown } from '../nutrition/catalog/math';

export type NutritionPreferencesDoc = NutritionPreferences<Timestamp>;
const MAX_FAVORITE_MEAL_OPTIONS = 10;
/**
 * Abuse/document-shape guard, not a product-facing "ten favorites" limit.
 * Kept in sync with Firestore Rules. Twenty total ids across foods + recipes
 * keeps full per-element validation below Firestore's expression budget.
 */
export const MAX_NUTRITION_FAVORITE_IDS = 20;

function prefsRef(uid: string) { return doc(db, 'users', uid, 'nutritionPreferences', 'current'); }
function favoritesRef(uid: string) { return collection(db, 'users', uid, 'nutritionFavoriteMealOptions'); }
function newFavoriteId() { return doc(collection(db, 'users')).id; }

export async function loadNutritionPreferences(uid: string): Promise<NutritionPreferencesDoc | null> {
  const [snap, favorites] = await Promise.all([
    getDoc(prefsRef(uid)),
    getDocs(query(favoritesRef(uid), orderBy('createdAt', 'desc'), limit(MAX_FAVORITE_MEAL_OPTIONS))),
  ]);
  if (!snap.exists() && favorites.empty) return null;
  const stored = snap.exists() ? snap.data() as NutritionPreferencesDoc : null;
  const persisted = favorites.docs
    .map((favorite) => favorite.data() as NutritionFavoriteMealOption<Timestamp>)
    .reverse();
  return {
    favoriteFoodIds: stored?.favoriteFoodIds ?? [],
    favoriteRecipeIds: stored?.favoriteRecipeIds ?? [],
    favoriteMealOptions: persisted.length > 0 ? persisted : stored?.favoriteMealOptions ?? [],
    updatedAt: stored?.updatedAt ?? persisted[persisted.length - 1]!.createdAt,
  };
}

/**
 * `favoriteFoodIds`/`favoriteRecipeIds` are two INDEPENDENT fields on the
 * same `nutritionPreferences/current` doc — a food is never a recipe, so
 * toggling one never reads or writes the other's array. On the very first
 * favorite ever (no doc yet), the full canonical shape (both arrays, one
 * empty) is created so the document never needs a later migration.
 */
async function toggleFavoriteId(
  uid: string, field: 'favoriteFoodIds' | 'favoriteRecipeIds', id: string,
): Promise<void> {
  if (id.length === 0 || id.length > 120) throw new Error('INVALID_NUTRITION_FAVORITE_ID');
  const ref = prefsRef(uid);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists() ? snapshot.data() as NutritionPreferencesDoc : null;
    const current = existing?.[field] ?? [];
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    const favoriteFoodIds = field === 'favoriteFoodIds' ? next : existing?.favoriteFoodIds ?? [];
    const favoriteRecipeIds = field === 'favoriteRecipeIds' ? next : existing?.favoriteRecipeIds ?? [];
    if (favoriteFoodIds.length + favoriteRecipeIds.length > MAX_NUTRITION_FAVORITE_IDS) {
      throw new Error('NUTRITION_FAVORITES_LIMIT');
    }
    if (existing) {
      // Always normalize both independent arrays. This upgrades a legacy
      // food-only preferences document without ever mixing the namespaces.
      transaction.update(ref, { favoriteFoodIds, favoriteRecipeIds, updatedAt: serverTimestamp() });
    }
    else {
      transaction.set(ref, {
        favoriteFoodIds,
        favoriteRecipeIds,
        updatedAt: serverTimestamp(),
      });
    }
  });
}

export async function toggleFavoriteFoodId(uid: string, foodId: string): Promise<void> {
  await toggleFavoriteId(uid, 'favoriteFoodIds', foodId);
}

export async function toggleFavoriteRecipeId(uid: string, recipeId: string): Promise<void> {
  await toggleFavoriteId(uid, 'favoriteRecipeIds', recipeId);
}

export type NewFavoriteMealOption = Omit<NutritionFavoriteMealOption<unknown>, 'id' | 'createdAt'>;

/** Keeps at most `MAX_FAVORITE_MEAL_OPTIONS`, dropping the oldest when already full — a personal shortcut list, not a historical record. */
export async function addFavoriteMealOption(uid: string, favorite: NewFavoriteMealOption): Promise<string> {
  const id = newFavoriteId();
  await setDoc(doc(favoritesRef(uid), id), { ...favorite, id, createdAt: serverTimestamp() });
  const newest = await getDocs(query(favoritesRef(uid), orderBy('createdAt', 'desc'), limit(MAX_FAVORITE_MEAL_OPTIONS + 1)));
  await Promise.all(newest.docs.slice(MAX_FAVORITE_MEAL_OPTIONS).map((favoriteDoc) => deleteDoc(favoriteDoc.ref)));
  return id;
}

export async function removeFavoriteMealOption(uid: string, favoriteId: string): Promise<void> {
  await deleteDoc(doc(favoritesRef(uid), favoriteId));
}

export interface FavoriteFoodView {
  foodId: string; name: string; origin: 'catalog' | 'custom' | 'food_log';
  nutritionPer100g: NutritionFoodNutritionValues | null; available: boolean;
}

/**
 * Resolves `favoriteFoodIds` into display records straight from the
 * canonical catalog/custom-food/food-log-catalog documents — the id is the
 * only thing ever persisted as a favorite (round brief §6), so there is no
 * stored nutrition snapshot that could ever drift from the real food. A
 * A food that no longer resolves, or a logging item later marked
 * hidden/deprecated, remains removable in the UI but cannot be selected.
 * ID prefix dispatch (`custom_`/`flc_`/else)
 * mirrors `resolveRecipeFoodValues` in `nutritionRecipes.ts` — same
 * namespace convention, extended here for the Fase C2 food-log catalog.
 */
export async function loadFavoriteFoods(uid: string, foodIds: readonly string[]): Promise<FavoriteFoodView[]> {
  return Promise.all(foodIds.map(async (foodId): Promise<FavoriteFoodView> => {
    const origin: 'catalog' | 'custom' | 'food_log' = foodId.startsWith('custom_') ? 'custom'
      : foodId.startsWith('flc_') ? 'food_log' : 'catalog';
    const food = origin === 'custom' ? await loadCustomFood(uid, foodId)
      : origin === 'food_log' ? await loadFoodLogEntry(foodId) : await loadCatalogFood(foodId);
    if (!food) return { foodId, name: '', origin, nutritionPer100g: null, available: false };
    const available = origin !== 'food_log' || !('status' in food) || food.status === 'active';
    return { foodId, name: food.name, origin, nutritionPer100g: available ? food.nutritionPer100g : null, available };
  }));
}

export interface FavoriteRecipeView { recipeId: string; name: string; breakdown: RecipeNutritionBreakdown }

/** Resolves `favoriteRecipeIds` into the SAME live-recalculated breakdown `CreateRecipeScreen` previews — never a stored macro. */
export async function loadFavoriteRecipes(uid: string, recipeIds: readonly string[]): Promise<FavoriteRecipeView[]> {
  const resolved = await Promise.all(recipeIds.map(async (recipeId): Promise<FavoriteRecipeView | null> => {
    const recipe = await loadNutritionRecipe(uid, recipeId);
    if (!recipe) return null;
    try {
      const breakdown = await calculateStoredRecipeBreakdown(uid, recipeId);
      return { recipeId, name: recipe.name, breakdown };
    } catch {
      return null;
    }
  }));
  return resolved.filter((item): item is FavoriteRecipeView => item != null);
}
