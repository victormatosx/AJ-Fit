import { collection, deleteDoc, doc, documentId, getDoc, getDocs, limit, orderBy,
  query, serverTimestamp, setDoc, startAfter, updateDoc, where, type Firestore, type QueryConstraint, type Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { NutritionCatalogMeta, NutritionCustomFood, NutritionFood, NutritionFoodNutritionValues } from '../types/nutrition';
import { normalizeFoodName, normalizeSearchText } from '../nutrition/catalog/normalize';
import { validateNutritionValues } from '../nutrition/catalog/math';

export interface CustomFoodInput { name: string; nutritionPer100g: NutritionFoodNutritionValues }

export function validateCustomFoodInput(input: unknown): asserts input is CustomFoodInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_CUSTOM_FOOD');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || !('name' in value) || !('nutritionPer100g' in value)) throw new Error('INVALID_CUSTOM_FOOD');
  normalizeFoodName(value.name as string);
  validateNutritionValues(value.nutritionPer100g);
}

function customRef(uid: string, foodId: string) { return doc(db, 'users', uid, 'nutritionFoods', foodId); }

export async function createCustomFood(uid: string, input: CustomFoodInput): Promise<string> {
  validateCustomFoodInput(input);
  const id = `custom_${doc(collection(db, 'users', uid, 'nutritionFoods')).id}`;
  await setDoc(customRef(uid, id), { id, name: normalizeFoodName(input.name),
    nutritionPer100g: input.nutritionPer100g, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return id;
}

export async function loadCustomFood(uid: string, foodId: string): Promise<NutritionCustomFood<Timestamp> | null> {
  const snap = await getDoc(customRef(uid, foodId));
  return snap.exists() ? snap.data() as NutritionCustomFood<Timestamp> : null;
}

/** Bounded — a user's own foods are never expected to be large; no server-side text search needed, filter client-side. */
export async function listCustomFoods(uid: string): Promise<NutritionCustomFood<Timestamp>[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'nutritionFoods'), limit(200)));
  return snap.docs.map((item) => item.data() as NutritionCustomFood<Timestamp>);
}

export async function updateCustomFood(uid: string, foodId: string, input: CustomFoodInput): Promise<void> {
  validateCustomFoodInput(input);
  await updateDoc(customRef(uid, foodId), { name: normalizeFoodName(input.name),
    nutritionPer100g: input.nutritionPer100g, updatedAt: serverTimestamp() });
}

export async function deleteCustomFood(uid: string, foodId: string): Promise<void> {
  await deleteDoc(customRef(uid, foodId));
}

export async function loadCatalogFood(foodId: string): Promise<NutritionFood<Timestamp> | null> {
  const snap = await getDoc(doc(db, 'nutritionFoods', foodId));
  return snap.exists() ? snap.data() as NutritionFood<Timestamp> : null;
}

export async function loadNutritionCatalogMeta(): Promise<NutritionCatalogMeta<Timestamp> | null> {
  const snap = await getDoc(doc(db, 'nutritionCatalogMeta', 'current'));
  return snap.exists() ? snap.data() as NutritionCatalogMeta<Timestamp> : null;
}

/** Prefix search (name and aliases), one bounded page at a time. */
export async function searchNutritionCatalog(
  text: string, options: { pageSize?: number; cursor?: string; firestore?: Firestore } = {},
): Promise<{ foods: NutritionFood<Timestamp>[]; nextCursor: string | null }> {
  const firestore = options.firestore ?? db;
  const prefix = normalizeSearchText(text);
  if (prefix.length < 2 || prefix.length > 32) throw new Error('INVALID_CATALOG_SEARCH');
  const pageSize = options.pageSize ?? 20;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 30) throw new Error('INVALID_PAGE_SIZE');
  const parts: QueryConstraint[] = [where('generationStatus', '==', 'approved'),
    where('searchPrefixes', 'array-contains', prefix), orderBy(documentId()), limit(pageSize)];
  if (options.cursor) {
    const cursor = await getDoc(doc(firestore, 'nutritionFoods', options.cursor));
    if (!cursor.exists()) throw new Error('INVALID_CATALOG_CURSOR');
    parts.push(startAfter(cursor));
  }
  const snap = await getDocs(query(collection(firestore, 'nutritionFoods'), ...parts));
  return { foods: snap.docs.map((item) => item.data() as NutritionFood<Timestamp>),
    nextCursor: snap.size === pageSize ? snap.docs[snap.docs.length - 1].id : null };
}
