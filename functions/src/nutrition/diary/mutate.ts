import { createHash } from 'node:crypto';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { db as defaultDb } from '../../lib/firebaseAdmin';
import { requireAuth } from '../../lib/auth';
import { planSnapshotRegistrationEnabled } from './config';
import { NUTRITION_MEAL_SLOTS, type NutritionLoggedFoodItem, type NutritionLoggedFoodSource,
  type NutritionMealOption, type NutritionMealSlot, type NutritionPlanSnapshotBase,
  type NutritionPlanSnapshotReference, type NutritionTotals, type NutritionFoodNutritionValues,
  type NutritionRecipe } from '../shared/types/nutrition';
import { calculateRecipeBreakdown, nutrientsForGrams, roundNutrition, roundNutritionValues, validateNutritionValues } from '../shared/nutrition/catalog/math';
import { DIARY_MAX_ITEMS_PER_DAY, DIARY_MAX_ITEMS_PER_MEAL, DIARY_NUTRIENTS,
  planSnapshotNutrition, validatePlanSnapshotBase } from '../shared/nutrition/diary/snapshot';
import { NUTRITION_ACTIVITY_SCHEMA_VERSION, STREAK_NUTRITION_DAYS_COLLECTION,
  STREAK_SETTINGS_COLLECTION, STREAK_SETTINGS_DOC_ID, canonicalStreakTimezone,
  resolveActivityDayWrite, nutritionActivityDeltas, nutritionActivityLocalDate,
  isStreakLocalDate } from '../shared/nutrition/diary/activity';

export const DIARY_PROTOCOL_COLLECTION = 'nutritionDiaryProtocol';
export const DIARY_RECEIPTS_COLLECTION = 'nutritionDiaryOperationReceipts';
type Item = NutritionLoggedFoodItem<Timestamp>;
type Origin = 'plan' | 'alternative' | 'favorite';
interface Input {
  requestId: string; expectedUid: string; localDate: string; timezone: string; slot: NutritionMealSlot;
  action: 'register_option' | 'add' | 'edit' | 'remove' | 'move';
  origin?: Origin; documentId?: string; optionId?: string;
  source?: Exclude<NutritionLoggedFoodSource, 'plan_snapshot'>; foodId?: string; quantity?: number;
  itemId?: string; toSlot?: NutritionMealSlot; expectedRevision?: number;
}
const fail = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
const slot = (v: unknown): v is NutritionMealSlot => NUTRITION_MEAL_SLOTS.includes(v as NutritionMealSlot);
function parse(value: unknown): Input {
  const invalid = (): never => { throw new HttpsError('invalid-argument', 'INVALID_DIARY_REQUEST'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const d = value as Input;
  const extra: Record<Input['action'], string[]> = { register_option: ['origin', 'documentId', 'optionId'],
    add: ['source', 'foodId', 'quantity'], edit: ['itemId', 'quantity', 'expectedRevision'], remove: ['itemId'], move: ['itemId', 'toSlot'] };
  if (!Object.hasOwn(extra, d.action) || Object.keys(d).some(k => !['action', 'requestId', 'expectedUid', 'localDate', 'timezone', 'slot', ...extra[d.action]].includes(k))
    || typeof d.expectedUid !== 'string' || !d.expectedUid || d.expectedUid.length > 128
    || !id(d.requestId) || d.requestId.length < 8 || !slot(d.slot)
    || typeof d.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.localDate)
    || !Number.isFinite(Date.parse(`${d.localDate}T12:00:00Z`))
    || new Date(`${d.localDate}T12:00:00Z`).toISOString().slice(0, 10) !== d.localDate
    || typeof d.timezone !== 'string' || !d.timezone || d.timezone.length > 80) return invalid();
  try { new Intl.DateTimeFormat('en', { timeZone: d.timezone }); } catch { return invalid(); }
  if (d.action === 'register_option' && (!['plan', 'alternative', 'favorite'].includes(d.origin!) || !id(d.documentId) || !id(d.optionId))) return invalid();
  if (d.action === 'add' && (!['catalog_food', 'food_log_catalog', 'custom_food', 'recipe'].includes(d.source!) || !id(d.foodId))) return invalid();
  if (['add', 'edit'].includes(d.action) && (!Number.isFinite(d.quantity) || d.quantity! <= 0 || d.quantity! > 10000)) return invalid();
  if (['edit', 'remove', 'move'].includes(d.action) && !id(d.itemId)) return invalid();
  if (d.action === 'edit' && (!Number.isInteger(d.expectedRevision) || d.expectedRevision! < 0)) return invalid();
  if (d.action === 'move' && (!slot(d.toSlot) || d.toSlot === d.slot)) return invalid();
  return d;
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;
  return JSON.stringify(v);
}
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
function sum(items: Item[]): NutritionTotals {
  return Object.fromEntries(DIARY_NUTRIENTS.map(k => [k, roundNutrition(items.reduce((s, item) => s + (item.snapshot[k] ?? 0), 0))])) as unknown as NutritionTotals;
}
function sumDay(meals: Map<NutritionMealSlot, Item[]>): NutritionTotals {
  const totals = [...meals.values()].map(sum);
  return Object.fromEntries(DIARY_NUTRIENTS.map(k => [k, roundNutrition(totals.reduce((s, n) => s + n[k], 0))])) as unknown as NutritionTotals;
}
function sameTotals(a: unknown, b: NutritionTotals): boolean {
  return !!a && DIARY_NUTRIENTS.every(k => typeof (a as NutritionTotals)[k] === 'number'
    && Math.abs((a as NutritionTotals)[k] - b[k]) <= .000001);
}
function validateStored(item: Item): void {
  try { validateNutritionValues(Object.fromEntries(DIARY_NUTRIENTS.filter(k => item.snapshot[k] != null).map(k => [k, item.snapshot[k]]))); }
  catch { fail('DIARY_INCONSISTENT'); }
  if (item.revision !== undefined && (!Number.isInteger(item.revision) || item.revision < 0)) fail('DIARY_INCONSISTENT');
  if (!id(item.id) || typeof item.snapshot.name !== 'string' || !(item.loggedAt instanceof Timestamp)) fail('DIARY_INCONSISTENT');
  if (item.source === 'plan_snapshot') {
    try {
      if ('foodId' in item || 'grams' in item) fail('DIARY_INCONSISTENT');
      const n = planSnapshotNutrition(item.base, item.quantity);
      if (item.unit !== item.base.unit || item.snapshot.name !== item.base.name || item.preparationNote !== item.base.preparationNote || !sameTotals(item.snapshot, n)) fail('DIARY_INCONSISTENT');
    } catch { fail('DIARY_INCONSISTENT'); }
  } else if (!['catalog_food', 'food_log_catalog', 'custom_food', 'recipe'].includes(item.source)
    || !id(item.foodId) || !Number.isFinite(item.grams) || item.grams <= 0) fail('DIARY_INCONSISTENT');
}
async function manualNutrition(tx: Transaction, db: Firestore, uid: string,
  source: Exclude<NutritionLoggedFoodSource, 'plan_snapshot'>, foodId: string): Promise<{ name: string; nutritionPer100g: NutritionFoodNutritionValues }> {
  const user = db.collection('users').doc(uid);
  const ref = source === 'catalog_food' ? db.collection('nutritionFoods').doc(foodId)
    : source === 'food_log_catalog' ? db.collection('foodLogCatalog').doc(foodId)
    : user.collection(source === 'recipe' ? 'nutritionRecipes' : 'nutritionFoods').doc(foodId);
  const snap = await tx.get(ref); const food = snap.data();
  if (!food || typeof food.name !== 'string') fail('DIARY_FOOD_NOT_FOUND');
  if (source === 'food_log_catalog' && food!.status !== 'active') fail('DIARY_FOOD_NOT_FOUND');
  if (source !== 'recipe') { validateNutritionValues(food!.nutritionPer100g); return { name: food!.name, nutritionPer100g: food!.nutritionPer100g }; }
  const recipe = food as NutritionRecipe;
  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length < 1 || recipe.ingredients.length > 6) fail('DIARY_INVALID_RECIPE');
  const values = new Map<string, NutritionFoodNutritionValues>();
  for (const ingredient of recipe.ingredients) {
    if (typeof ingredient.foodId !== 'string' || !/^(nf_|flc_|custom_)/.test(ingredient.foodId)) fail('DIARY_INVALID_RECIPE');
    const source = ingredient.foodId.startsWith('custom_') ? 'custom_food' : ingredient.foodId.startsWith('flc_') ? 'food_log_catalog' : 'catalog_food';
    const f = await manualNutrition(tx, db, uid, source, ingredient.foodId); values.set(ingredient.foodId, f.nutritionPer100g);
  }
  return { name: recipe.name, nutritionPer100g: calculateRecipeBreakdown(recipe, values).per100g };
}
async function readOption(tx: Transaction, db: Firestore, uid: string, d: Input) {
  const user = db.collection('users').doc(uid);
  let collection: 'nutritionPlans' | 'nutritionMealAlternatives' = d.origin === 'alternative' ? 'nutritionMealAlternatives' : 'nutritionPlans';
  let documentId = d.documentId!; let favorite: unknown;
  if (d.origin === 'favorite') {
    const f = await tx.get(user.collection('nutritionFavoriteMealOptions').doc(documentId));
    if (!f.exists || f.get('slot') !== d.slot || !['plan', 'alternative'].includes(f.get('source'))) fail('DIARY_OPTION_NOT_FOUND');
    collection = f.get('source') === 'plan' ? 'nutritionPlans' : 'nutritionMealAlternatives';
    documentId = f.get(collection === 'nutritionPlans' ? 'planId' : 'alternativeId'); favorite = f.get('foods');
    if (!id(documentId)) fail('DIARY_OPTION_NOT_FOUND');
  }
  const doc = await tx.get(user.collection(collection).doc(documentId));
  if (!doc.exists) fail('DIARY_OPTION_NOT_FOUND');
  const options: NutritionMealOption[] = collection === 'nutritionPlans' ? doc.get('meals')?.find((m: { slot: string }) => m.slot === d.slot)?.options ?? []
    : doc.get('slot') === d.slot ? doc.get('options') : [];
  const option = options.find(o => favorite ? canonical(o.foods) === canonical(favorite) : o.id === d.optionId);
  if (!option || !Array.isArray(option.foods) || option.foods.length < 1 || option.foods.length > 8) fail('DIARY_INVALID_OPTION');
  const bases: NutritionPlanSnapshotBase[] = option!.foods.map(f => {
    const base = { name: f.name, quantity: f.quantity, unit: f.unit, preparationNote: f.preparationNote, nutrition: f.estimatedNutrition as NutritionTotals };
    try { validatePlanSnapshotBase(base); } catch { fail('DIARY_INVALID_OPTION'); }
    return base;
  });
  const totals = Object.fromEntries(DIARY_NUTRIENTS.map(k => [k, roundNutrition(bases.reduce((s, b) => s + b.nutrition[k], 0))])) as unknown as NutritionTotals;
  if (!sameTotals(option!.totals, totals)) fail('DIARY_INVALID_OPTION');
  return { collection, documentId, option: option!, bases };
}

/** All diary mutations share this transaction and the same enrollment lock. No matcher or provider. */
export async function mutateNutritionDiaryV1Handler(request: CallableRequest, db: Firestore = defaultDb) {
  const uid = requireAuth(request); const d = parse(request.data);
  if (d.expectedUid !== uid) fail('DIARY_ACCOUNT_CHANGED');
  const user = db.collection('users').doc(uid);
  return db.runTransaction(async tx => {
    const protocolRef = user.collection(DIARY_PROTOCOL_COLLECTION).doc('current');
    const receiptRef = user.collection(DIARY_RECEIPTS_COLLECTION).doc(`request_${hash(d.requestId)}`);
    // Chama 2.0: the streak's canonical timezone. Read here (never written by
    // a client, see firestore.rules) so the activity day assigned below comes
    // from a stable, persisted zone instead of whatever zone the device
    // happens to be in — travelling must never reinterpret past evidence.
    const streakSettingsRef = user.collection(STREAK_SETTINGS_COLLECTION).doc(STREAK_SETTINGS_DOC_ID);
    const [lock, account, protocol, receipt, streakSettings] = await Promise.all([tx.get(db.collection('accountDeletionLocks').doc(uid)), tx.get(user), tx.get(protocolRef), tx.get(receiptRef), tx.get(streakSettingsRef)]);
    if (lock.exists || !account.exists) fail('ACCOUNT_INACTIVE');
    const { requestId: _requestId, ...payload } = d; const fingerprint = hash(payload);
    if (receipt.exists) {
      if (receipt.get('fingerprint') !== fingerprint) throw new HttpsError('already-exists', 'DIARY_REQUEST_CONFLICT');
      return { ...receipt.get('result'), replayed: true };
    }
    const registrationEnabled = planSnapshotRegistrationEnabled();
    if (!protocol.exists && !registrationEnabled) fail('DIARY_FEATURE_DISABLED');
    if (protocol.exists && protocol.get('version') !== 1) fail('DIARY_PROTOCOL_UNSUPPORTED');
    if (d.action === 'register_option' && !registrationEnabled) fail('DIARY_FEATURE_DISABLED');
    const selected = d.action === 'register_option' ? await readOption(tx, db, uid, d) : null;
    const registrationRef = selected ? user.collection(DIARY_RECEIPTS_COLLECTION).doc(`option_${hash([d.localDate, d.slot, selected.collection, selected.documentId, selected.option.id])}`) : null;
    const registration = registrationRef ? await tx.get(registrationRef) : null;
    if (registration?.exists) {
      const result = registration.get('result'); tx.create(receiptRef, { fingerprint, result, createdAt: Timestamp.now() });
      return { ...result, replayed: true };
    }
    const dayRef = user.collection('nutritionDailyLogs').doc(d.localDate);
    const day = await tx.get(dayRef);
    const before = new Map<NutritionMealSlot, Item[]>();
    // Enumerate fixed slots even when the parent is absent, detecting orphan
    // items instead of silently omitting them from day aggregates.
    for (const s of NUTRITION_MEAL_SLOTS) {
      const mealRef = dayRef.collection('meals').doc(s);
      const [meal, docs] = await Promise.all([tx.get(mealRef), tx.get(mealRef.collection('items').limit(49))]);
      if (docs.size >= 49 || (!meal.exists && !docs.empty)) fail('DIARY_INCONSISTENT');
      const items = docs.docs.map(doc => { const item = doc.data() as Item; if (item.id !== doc.id) fail('DIARY_INCONSISTENT'); validateStored(item); return item; });
      if (meal.exists && !sameTotals(meal.get('totals'), sum(items))) fail('DIARY_INCONSISTENT');
      if (meal.exists) before.set(s, items);
    }
    const oldItems = [...before.values()].flat();
    if (new Set(oldItems.map(item => item.id)).size !== oldItems.length || oldItems.length > 48 || (day.exists && (!sameTotals(day.get('totals'), sumDay(before)) || day.get('loggedItemCount') !== oldItems.length))
      || (!day.exists && oldItems.length)) fail('DIARY_INCONSISTENT');
    const after = new Map([...before].map(([s, items]) => [s, [...items]]));
    const current = after.get(d.slot) ?? []; after.set(d.slot, current); const now = Timestamp.now();
    // The streak's own clock: the SERVER instant resolved in the canonical
    // zone, never `d.localDate` (the diary date the client picked). Logging
    // today into yesterday's diary therefore earns TODAY.
    const streakTimezone = canonicalStreakTimezone(streakSettings.get('timezone'))
      ?? canonicalStreakTimezone(d.timezone) ?? 'UTC';
    const activityLocalDate = nutritionActivityLocalDate(now.toDate(), streakTimezone);
    let itemIds: string[] = [];
    if (selected) {
      itemIds = selected.bases.map((base, itemIndex) => {
        const itemId = `ps_${registrationRef!.id.slice(7, 47)}_${itemIndex}`;
        const planReference: NutritionPlanSnapshotReference = { collection: selected.collection, documentId: selected.documentId, optionId: selected.option.id, slot: d.slot, itemIndex };
        current.push({ id: itemId, source: 'plan_snapshot', quantity: base.quantity, unit: base.unit, preparationNote: base.preparationNote,
          base, planReference, snapshot: { name: base.name, ...base.nutrition }, loggedAt: now, revision: 0, activityLocalDate }); return itemId;
      });
    } else if (d.action === 'add') {
      const food = await manualNutrition(tx, db, uid, d.source!, d.foodId!);
      const n = roundNutritionValues(nutrientsForGrams(food.nutritionPer100g, d.quantity!));
      const itemId = `di_${hash(d.requestId).slice(0, 40)}`; itemIds = [itemId];
      current.push({ id: itemId, source: d.source!, foodId: d.foodId!, grams: d.quantity!,
        snapshot: { name: food.name, kcal: n.kcal, proteinG: n.proteinG, carbsG: n.carbsG, fatG: n.fatG, ...(n.fiberG != null ? { fiberG: n.fiberG } : {}) }, loggedAt: now, revision: 0, activityLocalDate });
    } else {
      const index = current.findIndex(x => x.id === d.itemId);
      if (index < 0) fail('DIARY_ITEM_NOT_FOUND');
      const item = current[index]; itemIds = [item.id];
      if (d.action === 'remove') current.splice(index, 1);
      else if (d.action === 'move') {
        current.splice(index, 1); const target = after.get(d.toSlot!) ?? []; after.set(d.toSlot!, target);
        target.push({ ...item, revision: (item.revision ?? 0) + 1 });
      } else {
        if ((item.revision ?? 0) !== d.expectedRevision) throw new HttpsError('aborted', 'DIARY_ITEM_CHANGED');
        if (item.source === 'plan_snapshot') {
          let nutrition: NutritionTotals;
          try { nutrition = planSnapshotNutrition(item.base, d.quantity!); } catch { fail('DIARY_INVALID_QUANTITY'); }
          current[index] = { ...item, quantity: d.quantity!, snapshot: { name: item.base.name, ...nutrition! }, revision: (item.revision ?? 0) + 1 };
        } else {
          const food = await manualNutrition(tx, db, uid, item.source, item.foodId);
          const n = roundNutritionValues(nutrientsForGrams(food.nutritionPer100g, d.quantity!));
          current[index] = { ...item, grams: d.quantity!, snapshot: { name: food.name, kcal: n.kcal, proteinG: n.proteinG,
            carbsG: n.carbsG, fatG: n.fatG, ...(n.fiberG != null ? { fiberG: n.fiberG } : {}) }, revision: (item.revision ?? 0) + 1 };
        }
      }
    }
    const all = [...after.values()].flat();
    if (all.length > DIARY_MAX_ITEMS_PER_DAY && all.length > oldItems.length
      || [...after].some(([s, items]) => items.length > DIARY_MAX_ITEMS_PER_MEAL && items.length > (before.get(s)?.length ?? 0))) fail('DIARY_ITEM_LIMIT');
    const dailyTotals = sumDay(after);
    try { validateNutritionValues(dailyTotals); } catch { fail('DIARY_INVALID_QUANTITY'); }

    // Chama 2.0 — which activity days this operation changes. Derived by
    // diffing item IDENTITIES between `before` and `after`, so an edit and a
    // move (same id on both sides, even across slots) contribute nothing at
    // all, while only genuine creations and genuine deletions move a counter.
    // A replay never reaches here: both receipt gates above already returned.
    const beforeIds = new Set(oldItems.map(item => item.id));
    const afterIds = new Set(all.map(item => item.id));
    const activityDeltas = nutritionActivityDeltas({
      created: all.filter(item => !beforeIds.has(item.id)),
      removed: oldItems.filter(item => !afterIds.has(item.id)),
      timezone: streakTimezone,
    });
    // Last reads of the transaction: only the aggregate days actually touched
    // (one for a creation, one for a deletion — never a scan of history).
    const evidenceFrom = isStreakLocalDate(streakSettings.get('nutritionEvidenceFrom'))
      ? streakSettings.get('nutritionEvidenceFrom') as string : null;
    const activityDays = await Promise.all([...activityDeltas].map(async ([localDate, delta]) => {
      const ref = user.collection(STREAK_NUTRITION_DAYS_COLLECTION).doc(localDate);
      const snapshot = await tx.get(ref);
      return {
        ref,
        localDate,
        delta,
        outcome: resolveActivityDayWrite({
          exists: snapshot.exists,
          storedCount: snapshot.get('activeItemCount'),
          delta,
          localDate,
          evidenceFrom,
        }),
      };
    }));
    // A defect in the streak's own bookkeeping must never be papered over: it
    // would either invent credit or erase a day that still has surviving
    // items. Same controlled failure the surrounding transaction already uses
    // for an inconsistent diary — nothing is written, nothing is repaired.
    if (activityDays.some(day => day.outcome.status === 'INCONSISTENT')) fail('DIARY_INCONSISTENT');
    const activityWrites = activityDays.flatMap(day =>
      day.outcome.status === 'WRITE' ? [{ ...day, outcome: day.outcome }] : []);

    const result = { status: 'recorded', itemIds };
    // All reads above; writers below. Account-wide cutover and first mutation are atomic.
    if (!protocol.exists) tx.create(protocolRef, { version: 1, enrolledAt: now });
    for (const day of activityWrites) {
      tx.set(day.ref, {
        localDate: day.localDate,
        activeItemCount: day.outcome.activeItemCount,
        timezone: streakTimezone,
        schemaVersion: NUTRITION_ACTIVITY_SCHEMA_VERSION,
        updatedAt: now,
      });
    }
    if (!streakSettings.exists || activityWrites.length) {
      // `nutritionEvidenceFrom` is the first activity day this account's
      // aggregate is authoritative for. A reader must NOT conclude "no food
      // that day" from a missing aggregate document older than this — it
      // falls back to the legacy day-document heuristic instead of inventing
      // evidence, or the absence of it, for records predating the counter.
      // `nutritionRevocations` only ever moves on a decrement: deletions are
      // the single operation that can retroactively break a past day, so a
      // client caching a resolved streak can detect exactly that and nothing
      // else, without polling.
      const revocations = activityWrites.filter(day => day.delta < 0).length;
      tx.set(streakSettingsRef, {
        timezone: streakTimezone,
        schemaVersion: NUTRITION_ACTIVITY_SCHEMA_VERSION,
        ...(streakSettings.exists ? {} : { createdAt: now }),
        // Only a real aggregate WRITE establishes the floor. A skipped
        // decrement (an item older than the counter) tracked nothing, so it
        // must not claim coverage it does not have.
        ...(activityWrites.length
          ? { nutritionEvidenceFrom: evidenceFrom ?? activityLocalDate }
          : {}),
        ...(revocations
          ? { nutritionRevocations: (Number.isInteger(streakSettings.get('nutritionRevocations'))
            ? streakSettings.get('nutritionRevocations') as number : 0) + revocations }
          : {}),
        updatedAt: now,
      }, { merge: true });
    }
    const touched = new Set([d.slot, ...(d.toSlot ? [d.toSlot] : [])]);
    for (const s of touched) {
      const meal = dayRef.collection('meals').doc(s); const items = after.get(s) ?? [];
      const ids = new Set(items.map(x => x.id));
      for (const item of before.get(s) ?? []) if (!ids.has(item.id)) tx.delete(meal.collection('items').doc(item.id));
      for (const item of items) {
        const previous = before.get(s)?.find(p => p.id === item.id);
        if (!previous || canonical(previous) !== canonical(item)) tx.set(meal.collection('items').doc(item.id), item);
      }
      if (!items.length) tx.delete(meal);
      else tx.set(meal, { slot: s, totals: sum(items), followedRecommendedOptionId: selected && s === d.slot && !(before.get(s)?.length) ? selected.option.id : null });
    }
    tx.set(dayRef, { localDate: d.localDate, timezone: day.get('timezone') ?? d.timezone,
      totals: dailyTotals, loggedItemCount: all.length, createdAt: day.get('createdAt') ?? now, updatedAt: now });
    tx.create(receiptRef, { fingerprint, result, createdAt: now });
    if (registrationRef) tx.create(registrationRef, { result, createdAt: now });
    return { ...result, replayed: false };
  });
}
export const mutateNutritionDiaryV1 = onCall({ enforceAppCheck: true, timeoutSeconds: 60 }, request => mutateNutritionDiaryV1Handler(request));
