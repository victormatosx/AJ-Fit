import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc, serverTimestamp, Timestamp as ClientTimestamp } from 'firebase/firestore';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { db } from '../../lib/firebaseAdmin';
import { mutateNutritionDiaryV1Handler, DIARY_PROTOCOL_COLLECTION, DIARY_RECEIPTS_COLLECTION } from '../diary/mutate';
import { normalizeFoodRecord } from '../shared/nutrition/catalog/normalize';
import type { NutritionLoggedFoodItem } from '../shared/types/nutrition';
import { deleteUserNutritionResources } from '../../accountDeletion/firestoreCleanup/resources';

const nutrients = ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const;
const n = { kcal: 156, proteinG: 6.8, carbsG: 26.5, fatG: 2.8, fiberG: 4.2 };
const date = '2026-10-18';
const food = (i: number) => ({ name: `Synthetic food ${i}`, quantity: [40, 200, 1, 50, 80, 30, 15, 5][i % 8],
  unit: ['g', 'ml', 'unidade'][i % 3], preparationNote: 'Synthetic preparation', estimatedNutrition: { ...n }, allergens: [] });
const option = (count: number) => ({ id: 'breakfast-1', foods: Array.from({ length: count }, (_, i) => food(i)),
  totals: Object.fromEntries(nutrients.map(k => [k, Math.round(n[k] * count * 100) / 100])) });
let uid: string; let foodId: string;
const user = () => db.collection('users').doc(uid);
function call(extra: Record<string, unknown>, requestId: string = randomUUID(), owner = uid, database = db) {
  return mutateNutritionDiaryV1Handler({ auth: { uid: owner }, data: { requestId, expectedUid: owner, localDate: date, timezone: 'America/Sao_Paulo', slot: 'breakfast', ...extra } } as CallableRequest, database);
}
const register = (extra: Record<string, unknown> = {}, requestId?: string) => call({ action: 'register_option', origin: 'plan', documentId: 'synthetic-plan', optionId: 'breakfast-1', ...extra }, requestId);
async function items(slot = 'breakfast') { return (await user().collection('nutritionDailyLogs').doc(date).collection('meals').doc(slot).collection('items').get()).docs.map(d => d.data() as NutritionLoggedFoodItem<Timestamp>); }
async function assertConsistent(expectedCount: number) {
  const day = user().collection('nutritionDailyLogs').doc(date); const meals = await day.collection('meals').get(); const total = Object.fromEntries(nutrients.map(k => [k, 0])); let count = 0;
  for (const m of meals.docs) {
    const entries = await m.ref.collection('items').get(); count += entries.size;
    for (const k of nutrients) {
      const sum = Math.round(entries.docs.reduce((s, d) => s + (d.get(`snapshot.${k}`) ?? 0), 0) * 100) / 100;
      expect(m.get(`totals.${k}`)).toBeCloseTo(sum, 8); total[k] += sum;
    }
  }
  const d = await day.get(); expect(count).toBe(expectedCount); expect(d.get('loggedItemCount')).toBe(expectedCount);
  for (const k of nutrients) expect(d.get(`totals.${k}`)).toBeCloseTo(total[k], 8);
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('plan snapshots and shared diary protocol — emulator only', () => {
  beforeEach(async () => {
    if (!process.env.GCLOUD_PROJECT?.startsWith('demo-') || !process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('EMULATOR_DEMO_REQUIRED');
    vi.stubEnv('NUTRITION_PLAN_SNAPSHOT_ENABLED', 'true'); uid = `snapshot-it-${randomUUID()}`;
    await user().set({ synthetic: true });
    const f = normalizeFoodRecord({ source: { type: 'taco', sourceId: uid, sourceName: 'Synthetic test' }, name: 'Synthetic catalog food',
      category: 'cereal', nutritionPer100g: n }, 'synthetic-v1'); foodId = f.id;
    await db.collection('nutritionFoods').doc(foodId).set(f);
    await user().collection('nutritionPlans').doc('synthetic-plan').set({ status: 'active', meals: [{ slot: 'breakfast', options: [option(3)], recommendedOptionId: 'breakfast-1' }] });
  });
  afterEach(async () => { await db.recursiveDelete(user()); await db.collection('nutritionFoods').doc(foodId).delete(); await db.collection('accountDeletionLocks').doc(uid).delete(); vi.unstubAllEnvs(); });
  it('account cleanup deletes protocol and persistent receipts only for the synthetic owner', async () => {
    await register();
    const other = db.collection('users').doc(`cleanup-non-owner-${randomUUID()}`);
    await other.collection(DIARY_PROTOCOL_COLLECTION).doc('current').set({ version: 1 });
    await other.collection(DIARY_RECEIPTS_COLLECTION).doc('synthetic-receipt').set({ synthetic: true });
    try {
      await deleteUserNutritionResources(uid, db);
      expect((await user().collection(DIARY_PROTOCOL_COLLECTION).get()).empty).toBe(true);
      expect((await user().collection(DIARY_RECEIPTS_COLLECTION).get()).empty).toBe(true);
      expect((await user().collection('nutritionDailyLogs').get()).empty).toBe(true);
      expect((await other.collection(DIARY_PROTOCOL_COLLECTION).doc('current').get()).exists).toBe(true);
      expect((await other.collection(DIARY_RECEIPTS_COLLECTION).doc('synthetic-receipt').get()).exists).toBe(true);
      expect((await db.collection('nutritionFoods').doc(foodId).get()).exists).toBe(true);
    } finally { await db.recursiveDelete(other); }
  });
  it('a disabled global switch cannot enroll an account through direct calls', async () => {
    vi.stubEnv('NUTRITION_PLAN_SNAPSHOT_ENABLED', 'false');
    await expect(register()).rejects.toThrow('DIARY_FEATURE_DISABLED');
    await expect(call({ action: 'add', source: 'catalog_food', foodId, quantity: 25 })).rejects.toThrow('DIARY_FEATURE_DISABLED');
    expect((await user().collection(DIARY_PROTOCOL_COLLECTION).get()).empty).toBe(true);
    expect((await user().collection(DIARY_RECEIPTS_COLLECTION).get()).empty).toBe(true);
    expect((await user().collection('nutritionDailyLogs').get()).empty).toBe(true);
  });
  it('allows independent authenticated UIDs, each resolving only its own persisted plan', async () => {
    const other = db.collection('users').doc(`global-snapshot-${randomUUID()}`);
    await other.set({ synthetic: true });
    try {
      await other.collection('nutritionPlans').doc('synthetic-plan').set({ meals: [{ slot: 'breakfast', options: [option(3)] }] });
      await register();
      await call({ action: 'register_option', origin: 'plan', documentId: 'synthetic-plan', optionId: 'breakfast-1' }, randomUUID(), other.id);
      expect((await other.collection(DIARY_PROTOCOL_COLLECTION).doc('current').get()).get('version')).toBe(1);
      expect((await other.collection('nutritionDailyLogs').doc(date).collection('meals').doc('breakfast').collection('items').get()).size).toBe(3);
      await assertConsistent(3);
      await expect(mutateNutritionDiaryV1Handler({ auth: { uid: other.id }, data: { requestId: randomUUID(), expectedUid: uid,
        action: 'register_option', origin: 'plan', documentId: 'synthetic-plan', optionId: 'breakfast-1',
        localDate: date, timezone: 'UTC', slot: 'breakfast' } } as CallableRequest, db)).rejects.toThrow('DIARY_ACCOUNT_CHANGED');
    } finally { await db.recursiveDelete(other); }
  });
  it('disabling the global flag preserves enrolled edit/move/delete/add and never removes the cutover', async () => {
    await register();
    vi.stubEnv('NUTRITION_PLAN_SNAPSHOT_ENABLED', 'false');
    const [entry] = await items();
    await call({ action: 'edit', itemId: entry.id, quantity: 20, expectedRevision: 0 });
    await call({ action: 'move', itemId: entry.id, toSlot: 'lunch' });
    await call({ action: 'remove', itemId: entry.id, slot: 'lunch' });
    await call({ action: 'add', source: 'catalog_food', foodId, quantity: 25, slot: 'lunch' });
    await assertConsistent(3);
    await expect(register()).rejects.toThrow('DIARY_FEATURE_DISABLED');
    expect((await user().collection(DIARY_PROTOCOL_COLLECTION).doc('current').get()).get('version')).toBe(1);
  });
  it.each([7, 8])('records all %i items exactly, without catalog IDs or invented grams', async count => {
    const o = option(count); await user().collection('nutritionPlans').doc('synthetic-plan').update({ meals: [{ slot: 'breakfast', options: [o] }] });
    await register(); const result = await items(); expect(result).toHaveLength(count);
    for (const item of result) {
      expect(item.source).toBe('plan_snapshot'); if (item.source !== 'plan_snapshot') throw new Error();
      const original = o.foods[item.planReference.itemIndex];
      expect(item.quantity).toBe(original.quantity); expect(item.unit).toBe(original.unit); expect(item.preparationNote).toBe(original.preparationNote);
      expect(item.snapshot).toEqual({ name: original.name, ...original.estimatedNutrition }); expect(item.base.nutrition).toEqual(original.estimatedNutrition);
      expect(item).not.toHaveProperty('foodId'); expect(item).not.toHaveProperty('grams');
    }
    await assertConsistent(count);
  });
  it('dedupes simultaneous taps, same request retry and cross-device requests', async () => {
    const requestId = randomUUID(); await Promise.all([register({}, requestId), register({}, requestId), register()]); await assertConsistent(3);
    expect((await register({}, requestId)).replayed).toBe(true); await assertConsistent(3);
  });
  it('keeps receipts after edits/deletes, never restores removed items on replay', async () => {
    const requestId = randomUUID(); await register({}, requestId); const [entry] = await items();
    await call({ action: 'edit', itemId: entry.id, quantity: 2, expectedRevision: 0 });
    await call({ action: 'remove', itemId: entry.id });
    await register({}, requestId); await register(); await assertConsistent(2); expect((await items()).some(i => i.id === entry.id)).toBe(false);
  });
  it.each(['g', 'ml', 'unidade'])('edits %s from immutable base even after source deletion', async unit => {
    const o = option(1); o.foods[0].unit = unit; await user().collection('nutritionPlans').doc('synthetic-plan').update({ meals: [{ slot: 'breakfast', options: [o] }] });
    await register(); const [entry] = await items(); await user().collection('nutritionPlans').doc('synthetic-plan').delete();
    await call({ action: 'edit', itemId: entry.id, quantity: 13.33, expectedRevision: 0 });
    await call({ action: 'edit', itemId: entry.id, quantity: 20, expectedRevision: 1 });
    const updated = (await items())[0]; expect(updated.snapshot.kcal).toBe(78); expect(updated.source).toBe('plan_snapshot');
    if (updated.source === 'plan_snapshot') { expect(updated.base.quantity).toBe(40); expect(updated.unit).toBe(unit); }
    await assertConsistent(1);
  });
  it('detects stale editing instead of overwriting a newer edit', async () => {
    await register(); const [entry] = await items();
    await call({ action: 'edit', itemId: entry.id, quantity: 20, expectedRevision: 0 });
    await expect(call({ action: 'edit', itemId: entry.id, quantity: 30, expectedRevision: 0 })).rejects.toThrow('DIARY_ITEM_CHANGED');
    await assertConsistent(3);
  });
  it.each(['add', 'edit', 'remove', 'move'])('serializes registration concurrent with manual %s', async action => {
    await call({ action: 'add', source: 'catalog_food', foodId, quantity: 100 }); const [entry] = await items();
    const command: Record<string, unknown> = action === 'add' ? { action, source: 'catalog_food', foodId, quantity: 25 }
      : action === 'edit' ? { action, itemId: entry.id, quantity: 50, expectedRevision: 0 }
      : action === 'move' ? { action, itemId: entry.id, toSlot: 'lunch' } : { action, itemId: entry.id };
    await Promise.all([register(), call(command)]); await assertConsistent(action === 'remove' ? 3 : action === 'add' ? 5 : 4);
  });
  it('replays a move after timeout without moving back or duplicating items', async () => {
    await register(); const [entry] = await items(); const requestId = randomUUID(); const payload = { action: 'move', itemId: entry.id, toSlot: 'lunch' };
    await call(payload, requestId); expect((await call(payload, requestId)).replayed).toBe(true); await assertConsistent(3); expect(await items('lunch')).toHaveLength(1);
  });
  it('rejects an identity change between preparing the command and calling the server', async () => {
    await expect(mutateNutritionDiaryV1Handler({ auth: { uid: 'another-synthetic-uid' }, data: {
      requestId: randomUUID(), expectedUid: uid, action: 'remove', slot: 'breakfast', itemId: 'entry', localDate: date, timezone: 'UTC',
    } } as CallableRequest, db)).rejects.toThrow('DIARY_ACCOUNT_CHANGED');
  });
  it('rejects request ID reuse with a different payload', async () => {
    const requestId = randomUUID(); await register({}, requestId);
    await expect(call({ action: 'add', source: 'catalog_food', foodId, quantity: 100 }, requestId)).rejects.toThrow('DIARY_REQUEST_CONFLICT'); await assertConsistent(3);
  });
  it('rejects a malformed late item without writing items, receipt or enrollment', async () => {
    const o = option(8); (o.foods[7].estimatedNutrition as unknown as { fiberG: null }).fiberG = null;
    await user().collection('nutritionPlans').doc('synthetic-plan').update({ meals: [{ slot: 'breakfast', options: [o] }] });
    await expect(register()).rejects.toThrow('DIARY_INVALID_OPTION'); expect(await items()).toHaveLength(0);
    expect((await user().collection(DIARY_PROTOCOL_COLLECTION).doc('current').get()).exists).toBe(false);
    expect((await user().collection(DIARY_RECEIPTS_COLLECTION).get()).empty).toBe(true);
  });
  it('rolls back queued writes when persistence fails at the final receipt', async () => {
    const injected = { collection: db.collection.bind(db), runTransaction: (fn: (tx: Transaction) => Promise<unknown>) => db.runTransaction(tx => fn(new Proxy(tx, {
      get(target, key) {
        if (key === 'create') return (ref: { path: string }, data: unknown) => { if (ref.path.includes(DIARY_RECEIPTS_COLLECTION)) throw new Error('synthetic-persistence-failure'); return target.create(ref as never, data as never); };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      },
    }))) } as unknown as Firestore;
    await expect(call({ action: 'register_option', origin: 'plan', documentId: 'synthetic-plan', optionId: 'breakfast-1' }, randomUUID(), uid, injected)).rejects.toThrow('synthetic-persistence-failure');
    expect(await items()).toHaveLength(0); expect((await user().collection(DIARY_PROTOCOL_COLLECTION).doc('current').get()).exists).toBe(false);
  });
  it('rejects arbitrary client nutrients and another UID, including unauthenticated calls', async () => {
    await expect(register({ estimatedNutrition: n })).rejects.toThrow('INVALID_DIARY_REQUEST');
    await expect(call({ action: 'register_option', origin: 'plan', documentId: 'synthetic-plan', optionId: 'breakfast-1' }, undefined, 'different-synthetic-uid')).rejects.toThrow('ACCOUNT_INACTIVE');
    await expect(mutateNutritionDiaryV1Handler({ data: {} } as CallableRequest, db)).rejects.toThrow('authenticated');
  });
  it('keeps enrolled manual CRUD available after feature rollback, but rejects new option registrations', async () => {
    vi.stubEnv('NUTRITION_PLAN_SNAPSHOT_ENABLED', 'false'); await expect(register()).rejects.toThrow('DIARY_FEATURE_DISABLED');
    vi.stubEnv('NUTRITION_PLAN_SNAPSHOT_ENABLED', 'true'); await register();
    vi.stubEnv('NUTRITION_PLAN_SNAPSHOT_ENABLED', 'false');
    await call({ action: 'add', source: 'catalog_food', foodId, quantity: 25, slot: 'lunch' }); await assertConsistent(4);
    await expect(register()).rejects.toThrow('DIARY_FEATURE_DISABLED');
  });
  it('rejects deletion-locked accounts and inconsistent legacy totals without silently repairing them', async () => {
    await db.collection('accountDeletionLocks').doc(uid).set({ synthetic: true }); await expect(register()).rejects.toThrow('ACCOUNT_INACTIVE');
    await db.collection('accountDeletionLocks').doc(uid).delete();
    await user().collection('nutritionDailyLogs').doc(date).set({ totals: { ...n }, loggedItemCount: 0 });
    await expect(register()).rejects.toThrow('DIARY_INCONSISTENT'); expect((await user().collection(DIARY_PROTOCOL_COLLECTION).doc('current').get()).exists).toBe(false);
  });
  it('preserves edit/delete support for historical catalog IDs without current namespaces', async () => {
    await db.collection('nutritionFoods').doc(`legacy-${uid}`).set({ name: 'Synthetic historical food', nutritionPer100g: n });
    try {
      await call({ action: 'add', source: 'catalog_food', foodId: `legacy-${uid}`, quantity: 100 });
      const [entry] = await items(); await call({ action: 'edit', itemId: entry.id, quantity: 50, expectedRevision: 0 });
      expect((await items())[0].snapshot.kcal).toBe(78); await call({ action: 'remove', itemId: entry.id }); await assertConsistent(0);
    } finally { await db.collection('nutritionFoods').doc(`legacy-${uid}`).delete(); }
  });
  it('keeps exact hierarchy totals for source estimates with more than two decimal places', async () => {
    const f = food(0); f.estimatedNutrition = { kcal: .005, proteinG: .005, carbsG: .005, fatG: .005, fiberG: .005 };
    const o = { id: 'breakfast-1', foods: [f], totals: { kcal: .01, proteinG: .01, carbsG: .01, fatG: .01, fiberG: .01 } };
    await user().collection('nutritionPlans').doc('synthetic-plan').update({ meals: [{ slot: 'breakfast', options: [o] }, { slot: 'lunch', options: [{ ...o, id: 'lunch-1' }] }] });
    await register(); await register({ slot: 'lunch', optionId: 'lunch-1' }); await assertConsistent(2);
    expect((await items())[0].snapshot.kcal).toBe(.005);
    expect((await user().collection('nutritionDailyLogs').doc(date).get()).get('totals.kcal')).toBe(.02);
  });
  it('supports the full six-by-eight daily plan without the legacy 36-item limit', async () => {
    const slots = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper'];
    await user().collection('nutritionPlans').doc('synthetic-plan').update({ meals: slots.map(slot => ({ slot, options: [{ ...option(8), id: `${slot}-1` }] })) });
    for (const slot of slots) await register({ slot, optionId: `${slot}-1` });
    await assertConsistent(48);
    await expect(call({ action: 'add', source: 'catalog_food', foodId, quantity: 1 })).rejects.toThrow('DIARY_ITEM_LIMIT');
    await assertConsistent(48);
  });
  it('rejects overflow atomically without truncating a second meal registration', async () => {
    const o = option(8); await user().collection('nutritionPlans').doc('synthetic-plan').update({ meals: [{ slot: 'breakfast', options: [o] }] });
    await register();
    await expect(call({ action: 'add', source: 'catalog_food', foodId, quantity: 25 })).rejects.toThrow('DIARY_ITEM_LIMIT');
    await assertConsistent(8);
  });
  it('records alternatives and validates favorites against their backend-owned original', async () => {
    const o = option(2); await user().collection('nutritionMealAlternatives').doc('alternative-a').set({ slot: 'breakfast', options: [o] });
    await user().collection('nutritionFavoriteMealOptions').doc('favorite-a').set({ source: 'alternative', alternativeId: 'alternative-a', slot: 'breakfast', foods: o.foods });
    await register({ origin: 'favorite', documentId: 'favorite-a', optionId: 'favorite-a' }); await assertConsistent(2);
    await register({ origin: 'alternative', documentId: 'alternative-a' }); await assertConsistent(2);
    await user().collection('nutritionFavoriteMealOptions').doc('favorite-a').update({ foods: [{ ...food(0), quantity: 1 }] });
    await expect(register({ origin: 'favorite', documentId: 'favorite-a', optionId: 'favorite-a' })).rejects.toThrow('DIARY_INVALID_OPTION');
  });
  it('blocks a legacy writer that captured stale items before the account cutover', async () => {
    const environment = await initializeTestEnvironment({ projectId: process.env.GCLOUD_PROJECT!,
      firestore: { host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_HOST!.split(':')[1]),
        rules: readFileSync(resolve(__dirname, '../../../../firestore.rules'), 'utf8') } });
    try {
      const client = environment.authenticatedContext(uid).firestore();
      const day = doc(client, 'users', uid, 'nutritionDailyLogs', date);
      const meal = doc(day, 'meals', 'breakfast');
      const old = { id: 'old-manual', source: 'catalog_food', foodId, grams: 100,
        snapshot: { name: 'Synthetic legacy', ...n }, loggedAt: ClientTimestamp.now() };
      await setDoc(doc(meal, 'items', old.id), old);
      await setDoc(meal, { slot: 'breakfast', totals: n });
      await setDoc(day, { localDate: date, timezone: 'UTC', totals: n, loggedItemCount: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      const stale = await getDocs(collection(meal, 'items')); expect(stale.size).toBe(1);
      await register();
      // This would previously clobber the four-item aggregate with one old item.
      await assertFails(setDoc(meal, { slot: 'breakfast', totals: n }));
      await assertFails(setDoc(doc(meal, 'items', 'stale-manual'), { ...old, id: 'stale-manual' }));
      await assertConsistent(4);
    } finally { await environment.cleanup(); }
  });
  it('recomputes recipes from actual ingredient records and preserves existing manual records', async () => {
    await user().collection('nutritionRecipes').doc('recipe_a').set({ name: 'Synthetic recipe', ingredients: [{ foodId, grams: 100 }], finalWeightG: 200 });
    await call({ action: 'add', source: 'recipe', foodId: 'recipe_a', quantity: 100 });
    const [entry] = await items(); expect(entry.snapshot.kcal).toBe(78);
    await register(); await assertConsistent(4);
    const copy = (await items()).find(i => i.id === entry.id)!; expect(copy).toEqual(entry);
  });
}, 60_000);
