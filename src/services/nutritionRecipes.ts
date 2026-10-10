import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, runTransaction, serverTimestamp, setDoc,
  type Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { NutritionFoodNutritionValues, NutritionRecipe, NutritionRecipeIngredient } from '../types/nutrition';
import { calculateRecipeBreakdown, calculateRecipeNutrition, type RecipeNutritionBreakdown } from '../nutrition/catalog/math';
import { normalizeFoodName } from '../nutrition/catalog/normalize';
import { loadCatalogFood, loadCustomFood } from './nutritionFoods';
import { loadFoodLogEntry } from './foodLogCatalog';

export interface RecipeInput {
  name: string; description?: string; ingredients: NutritionRecipeIngredient[];
  finalWeightG?: number; servings?: number;
}

const RECIPE_FIELDS = ['name', 'description', 'ingredients', 'finalWeightG', 'servings'];

export function validateRecipeInput(input: unknown): asserts input is RecipeInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_RECIPE');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !RECIPE_FIELDS.includes(key))) throw new Error('INVALID_RECIPE');
  normalizeFoodName(value.name as string);
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 1000)) throw new Error('INVALID_RECIPE');
  if (!Array.isArray(value.ingredients) || value.ingredients.length < 1 || value.ingredients.length > 6) throw new Error('INVALID_RECIPE');
  for (const ingredient of value.ingredients) {
    if (!ingredient || typeof ingredient !== 'object' || Array.isArray(ingredient)
      || Object.keys(ingredient).length !== 2 || typeof ingredient.foodId !== 'string'
      || ingredient.foodId.length < 1 || ingredient.foodId.length > 120
      || typeof ingredient.grams !== 'number' || !Number.isFinite(ingredient.grams)
      || ingredient.grams <= 0 || ingredient.grams > 10000) throw new Error('INVALID_RECIPE');
  }
  // Water loss/gain during preparation (round brief §5) — any positive weight is plausible, same upper bound as a single ingredient.
  if (value.finalWeightG !== undefined && (typeof value.finalWeightG !== 'number' || !Number.isFinite(value.finalWeightG)
    || value.finalWeightG <= 0 || value.finalWeightG > 10000)) throw new Error('INVALID_RECIPE');
  if (value.servings !== undefined && (typeof value.servings !== 'number' || !Number.isInteger(value.servings)
    || value.servings <= 0 || value.servings > 100)) throw new Error('INVALID_RECIPE');
}

function recipeRef(uid: string, recipeId: string) { return doc(db, 'users', uid, 'nutritionRecipes', recipeId); }
export async function createNutritionRecipe(uid: string, input: RecipeInput): Promise<string> {
  validateRecipeInput(input);
  const id = `recipe_${doc(collection(db, 'users', uid, 'nutritionRecipes')).id}`;
  await setDoc(recipeRef(uid, id), { id, name: normalizeFoodName(input.name),
    ...(input.description ? { description: input.description.trim() } : {}),
    ...(input.finalWeightG != null ? { finalWeightG: input.finalWeightG } : {}),
    ...(input.servings != null ? { servings: input.servings } : {}),
    ingredients: input.ingredients, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return id;
}
export async function loadNutritionRecipe(uid: string, recipeId: string): Promise<NutritionRecipe<Timestamp> | null> {
  const snap = await getDoc(recipeRef(uid, recipeId));
  return snap.exists() ? snap.data() as NutritionRecipe<Timestamp> : null;
}

/** Bounded — a user's own recipes are never expected to be large; filter client-side like `listCustomFoods`. */
export async function listNutritionRecipes(uid: string): Promise<NutritionRecipe<Timestamp>[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'nutritionRecipes'), limit(200)));
  return snap.docs.map((item) => item.data() as NutritionRecipe<Timestamp>);
}
export async function updateNutritionRecipe(uid: string, recipeId: string, input: RecipeInput): Promise<void> {
  validateRecipeInput(input);
  await runTransaction(db, async (transaction) => {
    const ref = recipeRef(uid, recipeId);
    const current = await transaction.get(ref);
    if (!current.exists()) throw new Error('RECIPE_NOT_FOUND');
    transaction.set(ref, { id: recipeId, name: normalizeFoodName(input.name),
      ...(input.description ? { description: input.description.trim() } : {}),
      ...(input.finalWeightG != null ? { finalWeightG: input.finalWeightG } : {}),
      ...(input.servings != null ? { servings: input.servings } : {}),
      ingredients: input.ingredients, createdAt: current.data().createdAt, updatedAt: serverTimestamp() });
  });
}
export async function deleteNutritionRecipe(uid: string, recipeId: string): Promise<void> {
  await deleteDoc(recipeRef(uid, recipeId));
}

export async function resolveRecipeFoodValues(
  uid: string, recipe: Pick<NutritionRecipe, 'ingredients'>,
): Promise<Map<string, NutritionFoodNutritionValues>> {
  const ids = [...new Set(recipe.ingredients.map((item) => item.foodId))];
  const foods = await Promise.all(ids.map(async (id) => {
    if (id.startsWith('custom_')) return loadCustomFood(uid, id);
    if (id.startsWith('flc_')) return loadFoodLogEntry(id);
    if (id.startsWith('nf_')) return loadCatalogFood(id);
    throw new Error(`UNKNOWN_RECIPE_FOOD_NAMESPACE:${id}`);
  }));
  const values = new Map<string, NutritionFoodNutritionValues>();
  ids.forEach((id, index) => { if (foods[index]) values.set(id, foods[index].nutritionPer100g); });
  return values;
}

/** No stored client macro is read. Re-resolve current ingredient records on every calculation. */
export async function calculateStoredRecipeNutrition(uid: string, recipeId: string): Promise<NutritionFoodNutritionValues> {
  const recipe = await loadNutritionRecipe(uid, recipeId);
  if (!recipe) throw new Error('RECIPE_NOT_FOUND');
  const values = await resolveRecipeFoodValues(uid, recipe);
  return calculateRecipeNutrition(recipe.ingredients, values);
}

/**
 * The full total/per100g/perServing derivation (`calculateRecipeBreakdown`)
 * against CURRENT ingredient records — the same never-trust-a-stored-macro
 * rule `calculateStoredRecipeNutrition` already follows, just returning the
 * richer breakdown instead of only the total.
 */
export async function calculateStoredRecipeBreakdown(uid: string, recipeId: string): Promise<RecipeNutritionBreakdown> {
  const recipe = await loadNutritionRecipe(uid, recipeId);
  if (!recipe) throw new Error('RECIPE_NOT_FOUND');
  const values = await resolveRecipeFoodValues(uid, recipe);
  return calculateRecipeBreakdown(recipe, values);
}
