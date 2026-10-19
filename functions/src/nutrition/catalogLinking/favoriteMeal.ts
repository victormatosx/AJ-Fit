import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { requireAuth } from '../../lib/auth';
import { requireActiveAccount } from '../../accountDeletion/activeAccountGuard';
import { db as defaultDb } from '../../lib/firebaseAdmin';
import { isCatalogLinkedOption } from '../shared/nutrition/catalog/binding';
import { NUTRITION_MEAL_SLOTS, type NutritionMealOption } from '../shared/types/nutrition';

/** Bookmarks copy only a backend-persisted option, not client nutrition/bindings. */
export async function favoriteCatalogMealHandler(request: CallableRequest, db: Firestore = defaultDb) {
  const uid = requireAuth(request);
  const d = request.data as { origin: 'plan' | 'alternative'; documentId: string; optionId: string; slot: string };
  if (!d || Object.keys(d).some(k => !['origin', 'documentId', 'optionId', 'slot'].includes(k))
    || !['plan', 'alternative'].includes(d.origin) || ![d.documentId, d.optionId].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v))
    || !NUTRITION_MEAL_SLOTS.includes(d.slot as typeof NUTRITION_MEAL_SLOTS[number])) throw new HttpsError('invalid-argument', 'INVALID_REQUEST');
  await requireActiveAccount(uid, db);
  const user = db.collection('users').doc(uid); const ref = user.collection('nutritionFavoriteMealOptions').doc();
  return db.runTransaction(async tx => {
    const [lock, source, existing] = await Promise.all([tx.get(db.collection('accountDeletionLocks').doc(uid)),
      tx.get(user.collection(d.origin === 'plan' ? 'nutritionPlans' : 'nutritionMealAlternatives').doc(d.documentId)),
      tx.get(user.collection('nutritionFavoriteMealOptions').orderBy('createdAt', 'desc').limit(10))]);
    if (lock.exists) throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE');
    if (!source.exists) throw new HttpsError('not-found', 'DIARY_OPTION_NOT_FOUND');
    const options: NutritionMealOption[] = d.origin === 'plan'
      ? (source.get('meals') as { slot: string; options: NutritionMealOption[] }[])?.find(m => m.slot === d.slot)?.options ?? []
      : source.get('slot') === d.slot ? source.get('options') : [];
    const option = options.find(o => o.id === d.optionId);
    if (!option || !isCatalogLinkedOption(option.foods)) throw new HttpsError('failed-precondition', 'DIARY_OPTION_NOT_LINKED');
    tx.create(ref, { id: ref.id, source: d.origin, ...(d.origin === 'plan' ? { planId: d.documentId } : { alternativeId: d.documentId }),
      slot: d.slot, foods: option.foods, totals: option.totals, createdAt: Timestamp.now() });
    if (existing.size === 10) tx.delete(existing.docs[9].ref);
    return { favoriteId: ref.id };
  });
}
export const favoriteCatalogMeal = onCall({ enforceAppCheck: true, timeoutSeconds: 30 }, request => favoriteCatalogMealHandler(request));
