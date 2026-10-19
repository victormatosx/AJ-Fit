import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { db as defaultDb } from '../../lib/firebaseAdmin';
import { requireAuth } from '../../lib/auth';
import { requireActiveAccount } from '../../accountDeletion/activeAccountGuard';
import { NUTRITION_MEAL_SLOTS, type NutritionMealOption, type NutritionPlanFoodItem, type NutritionProfile,
  type NutritionTotals } from '../shared/types/nutrition';
import { catalogNutritionRevision, catalogItemNutrition, isCatalogLinkedOption } from '../shared/nutrition/catalog/binding';
import { nutritionFailure, restrictionFailure } from './resolver';

interface LogInput {
  requestId: string; origin: 'plan' | 'alternative' | 'favorite'; documentId: string;
  optionId: string; slot: string; localDate: string; timezone: string;
}
const zero = (): NutritionTotals => ({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 });
function parse(data: unknown): LogInput {
  const v = data as LogInput;
  if (!v || typeof v !== 'object' || Object.keys(v).some(k => !['requestId', 'origin', 'documentId', 'optionId', 'slot', 'localDate', 'timezone'].includes(k))
    || typeof v.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(v.requestId) || !['plan', 'alternative', 'favorite'].includes(v.origin)
    || ![v.documentId, v.optionId].every(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(x))
    || !NUTRITION_MEAL_SLOTS.includes(v.slot as typeof NUTRITION_MEAL_SLOTS[number])
    || typeof v.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.localDate)
    || !Number.isFinite(Date.parse(`${v.localDate}T12:00:00Z`))
    || new Date(`${v.localDate}T12:00:00Z`).toISOString().slice(0, 10) !== v.localDate
    || typeof v.timezone !== 'string' || v.timezone.length > 80) throw new HttpsError('invalid-argument', 'INVALID_REQUEST');
  try { new Intl.DateTimeFormat('en', { timeZone: v.timezone }); }
  catch { throw new HttpsError('invalid-argument', 'INVALID_REQUEST'); }
  return v;
}
const foodIdentity = (foods: NutritionPlanFoodItem[]) => JSON.stringify(foods.map(f => f.catalogBinding ?? null));

/** Consumption by persisted reference only. No search, matching, or client nutrition values. */
export async function logCatalogMealHandler(request: CallableRequest, db: Firestore = defaultDb) {
  const uid = requireAuth(request); const input = parse(request.data);
  await requireActiveAccount(uid, db);
  const user = db.collection('users').doc(uid);
  return db.runTransaction(async tx => {
    const receiptRef = user.collection('nutritionCatalogLogReceipts').doc(input.requestId);
    const [lock, receipt, protocol] = await Promise.all([tx.get(db.collection('accountDeletionLocks').doc(uid)), tx.get(receiptRef), tx.get(user.collection('nutritionDiaryProtocol').doc('current'))]);
    if (protocol.exists) throw new HttpsError('failed-precondition', 'DIARY_PROTOCOL_REQUIRED');
    if (lock.exists) throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE');
    const requestKey = JSON.stringify([input.origin, input.documentId, input.optionId, input.slot, input.localDate]);
    if (receipt.exists) {
      if (receipt.get('requestKey') !== requestKey) throw new HttpsError('already-exists', 'DIARY_REQUEST_CONFLICT');
      return { status: 'recorded', replayed: true };
    }
    let origin: 'plan' | 'alternative' = input.origin === 'alternative' ? 'alternative' : 'plan';
    let documentId = input.documentId; let favoriteFoods: NutritionPlanFoodItem[] | null = null;
    if (input.origin === 'favorite') {
      const favorite = await tx.get(user.collection('nutritionFavoriteMealOptions').doc(documentId));
      if (!favorite.exists || favorite.get('slot') !== input.slot) throw new HttpsError('not-found', 'DIARY_OPTION_NOT_FOUND');
      origin = favorite.get('source'); documentId = favorite.get(origin === 'plan' ? 'planId' : 'alternativeId');
      if (!['plan', 'alternative'].includes(origin) || typeof documentId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(documentId)) throw new HttpsError('failed-precondition', 'DIARY_OPTION_NOT_FOUND');
      favoriteFoods = favorite.get('foods');
    }
    const source = await tx.get(user.collection(origin === 'plan' ? 'nutritionPlans' : 'nutritionMealAlternatives').doc(documentId));
    if (!source.exists) throw new HttpsError('not-found', 'DIARY_OPTION_NOT_FOUND');
    const options: NutritionMealOption[] = origin === 'plan'
      ? (source.get('meals') as { slot: string; options: NutritionMealOption[] }[])?.find(m => m.slot === input.slot)?.options ?? []
      : source.get('slot') === input.slot ? source.get('options') : [];
    const option = options.find(o => favoriteFoods ? foodIdentity(o.foods) === foodIdentity(favoriteFoods) : o.id === input.optionId);
    if (!option || !isCatalogLinkedOption(option.foods) || option.foods.length > 6) throw new HttpsError('failed-precondition', 'DIARY_OPTION_NOT_LINKED');
    const profileSnap = await tx.get(user.collection('nutritionProfile').doc('current'));
    const profile = profileSnap.data() as NutritionProfile | undefined;
    if (!profile) throw new HttpsError('failed-precondition', 'INVALID_NUTRITION_PROFILE');
    const exclusions = await Promise.all(profile.excludedFoodIds.map(id => tx.get(id.startsWith('custom_')
      ? user.collection('nutritionFoods').doc(id) : db.collection(id.startsWith('flc_') ? 'foodLogCatalog' : 'nutritionFoods').doc(id))));
    if (exclusions.some(d => !d.exists || typeof d.get('name') !== 'string')) throw new HttpsError('failed-precondition', 'INVALID_NUTRITION_PROFILE');
    const names = { preferred: [], usual: [], excluded: exclusions.map(d => d.get('name') as string) };
    const foods = await Promise.all(option.foods.map(f => tx.get(db.collection(f.catalogBinding!.collection).doc(f.catalogBinding!.foodId))));
    const items = foods.map((doc, i) => {
      const b = option.foods[i].catalogBinding!;
      if (!doc.exists) throw new HttpsError('failed-precondition', 'DIARY_CATALOG_CHANGED');
      const food = { ...doc.data(), id: doc.id } as Parameters<typeof catalogNutritionRevision>[0];
      const candidate = { collection: b.collection, food: food as Parameters<typeof nutritionFailure>[0]['food'] };
      if (catalogNutritionRevision(food) !== b.nutritionRevision || nutritionFailure(candidate)
        || restrictionFailure(candidate, profile, names)) throw new HttpsError('failed-precondition', 'DIARY_CATALOG_CHANGED');
      const n = catalogItemNutrition({ ...b, nutritionPer100g: food.nutritionPer100g });
      return { id: `cl_${input.requestId}_${i}`, source: b.collection === 'nutritionFoods' ? 'catalog_food' : 'food_log_catalog',
        foodId: b.foodId, grams: b.grams, snapshot: { name: food.name, ...n }, loggedAt: Timestamp.now() };
    });
    const dayRef = user.collection('nutritionDailyLogs').doc(input.localDate);
    const mealRef = dayRef.collection('meals').doc(input.slot);
    const [day, meal, existingItems] = await Promise.all([tx.get(dayRef), tx.get(mealRef), tx.get(mealRef.collection('items'))]);
    if (existingItems.size + items.length > 6 || (day.get('loggedItemCount') ?? 0) + items.length > 36) throw new HttpsError('failed-precondition', 'DIARY_ITEM_LIMIT');
    const delta = zero(); for (const item of items) for (const k of Object.keys(delta) as (keyof NutritionTotals)[]) delta[k] += item.snapshot[k] ?? 0;
    const plus = (base: NutritionTotals) => Object.fromEntries(Object.entries(delta).map(([k, v]) => [k, Math.round(((base[k as keyof NutritionTotals] ?? 0) + v) * 100) / 100]));
    for (const item of items) tx.create(mealRef.collection('items').doc(item.id), item);
    tx.set(mealRef, { slot: input.slot, totals: plus(meal.get('totals') ?? zero()),
      followedRecommendedOptionId: existingItems.empty ? option.id : null });
    tx.set(dayRef, { localDate: input.localDate, timezone: day.get('timezone') ?? input.timezone,
      totals: plus(day.get('totals') ?? zero()), loggedItemCount: (day.get('loggedItemCount') ?? 0) + items.length,
      createdAt: day.get('createdAt') ?? Timestamp.now(), updatedAt: Timestamp.now() });
    tx.create(receiptRef, { requestKey, createdAt: Timestamp.now() });
    return { status: 'recorded', replayed: false };
  });
}
export const logCatalogMeal = onCall({ enforceAppCheck: true, timeoutSeconds: 30 }, request => logCatalogMealHandler(request));
