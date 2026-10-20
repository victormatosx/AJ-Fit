import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { db } from '../../lib/firebaseAdmin';
import { mutateNutritionDiaryV1Handler, DIARY_RECEIPTS_COLLECTION } from '../diary/mutate';
import { normalizeFoodRecord } from '../shared/nutrition/catalog/normalize';
import {
  STREAK_NUTRITION_DAYS_COLLECTION,
  STREAK_SETTINGS_COLLECTION,
  STREAK_SETTINGS_DOC_ID,
} from '../shared/nutrition/diary/activity';
import { deleteUserNutritionResources } from '../../accountDeletion/firestoreCleanup/resources';

/**
 * Chama 2.0 — nutrition evidence aggregate, driven through the real callable.
 *
 * Every assertion below is about `streakNutritionDays/{activityLocalDate}
 * .activeItemCount`: the ONLY fact the streak consults for nutrition. The
 * seven product scenarios are named in the test titles.
 */

const nutrients = ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const;
const n = { kcal: 156, proteinG: 6.8, carbsG: 26.5, fatG: 2.8, fiberG: 4.2 };
/** Diary date deliberately distinct from any real "today" — it must never be the activity day. */
const diaryDate = '2026-10-18';
const TZ = 'America/Sao_Paulo';

const food = (i: number) => ({
  name: `Synthetic food ${i}`, quantity: [40, 200, 1, 50, 80, 30, 15, 5][i % 8],
  unit: ['g', 'ml', 'unidade'][i % 3], preparationNote: 'Synthetic preparation',
  estimatedNutrition: { ...n }, allergens: [],
});
const option = (count: number) => ({
  id: 'breakfast-1', foods: Array.from({ length: count }, (_, i) => food(i)),
  totals: Object.fromEntries(nutrients.map(k => [k, Math.round(n[k] * count * 100) / 100])),
});

let uid: string; let foodId: string;
const user = () => db.collection('users').doc(uid);

function call(extra: Record<string, unknown>, requestId: string = randomUUID(), localDate = diaryDate) {
  return mutateNutritionDiaryV1Handler({
    auth: { uid },
    data: { requestId, expectedUid: uid, localDate, timezone: TZ, slot: 'breakfast', ...extra },
  } as CallableRequest, db);
}
const register = (extra: Record<string, unknown> = {}, requestId?: string) =>
  call({ action: 'register_option', origin: 'plan', documentId: 'synthetic-plan', optionId: 'breakfast-1', ...extra }, requestId);
const addManual = (requestId?: string, localDate = diaryDate) =>
  call({ action: 'add', source: 'catalog_food', foodId, quantity: 100 }, requestId, localDate);

async function items(slot = 'breakfast', localDate = diaryDate) {
  const snapshot = await user().collection('nutritionDailyLogs').doc(localDate)
    .collection('meals').doc(slot).collection('items').get();
  return snapshot.docs.map(document => document.data());
}
async function activeCount(activityLocalDate: string): Promise<number | null> {
  const snapshot = await user().collection(STREAK_NUTRITION_DAYS_COLLECTION).doc(activityLocalDate).get();
  return snapshot.exists ? snapshot.get('activeItemCount') as number : null;
}
async function settings() {
  const snapshot = await user().collection(STREAK_SETTINGS_COLLECTION).doc(STREAK_SETTINGS_DOC_ID).get();
  return snapshot.exists ? snapshot.data()! : null;
}
/** The activity day the backend assigned to the item it just created. */
async function assignedDay(): Promise<string> {
  const all = await items();
  return all[0]!.activityLocalDate as string;
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('nutrition evidence aggregate — emulator only', () => {
  beforeEach(async () => {
    if (!process.env.GCLOUD_PROJECT?.startsWith('demo-') || !process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')) {
      throw new Error('EMULATOR_DEMO_REQUIRED');
    }
    vi.stubEnv('NUTRITION_PLAN_SNAPSHOT_ENABLED', 'true');
    uid = `streak-evidence-it-${randomUUID()}`;
    await user().set({ synthetic: true });
    const record = normalizeFoodRecord({
      source: { type: 'taco', sourceId: uid, sourceName: 'Synthetic test' },
      name: 'Synthetic catalog food', category: 'cereal', nutritionPer100g: n,
    }, 'synthetic-v1');
    foodId = record.id;
    await db.collection('nutritionFoods').doc(foodId).set(record);
    await user().collection('nutritionPlans').doc('synthetic-plan').set({
      status: 'active',
      meals: [{ slot: 'breakfast', options: [option(7)], recommendedOptionId: 'breakfast-1' }],
    });
  });

  afterEach(async () => {
    await db.recursiveDelete(user());
    await db.collection('nutritionFoods').doc(foodId).delete();
    await db.collection('accountDeletionLocks').doc(uid).delete();
    vi.unstubAllEnvs();
  });

  it('stamps every created item with the activity day and pins the canonical timezone', async () => {
    await addManual();
    const day = await assignedDay();
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Cenário 6 / H: the diary date is NOT the activity day.
    expect(day).not.toBe(diaryDate);
    const stored = await settings();
    expect(stored?.timezone).toBe(TZ);
    expect(stored?.nutritionEvidenceFrom).toBe(day);
    expect(stored?.schemaVersion).toBe(1);
    expect(await activeCount(day)).toBe(1);
  });

  it('Cenário 4 (B): a seven-food prescribed meal counts seven items on ONE day', async () => {
    await register();
    const day = await assignedDay();
    expect((await items()).length).toBe(7);
    expect(await activeCount(day)).toBe(7);
    // The streak reads `> 0`, so one day — never seven.
    const days = await user().collection(STREAK_NUTRITION_DAYS_COLLECTION).get();
    expect(days.size).toBe(1);
  });

  it('Cenário 1: deleting the only food of the day drops the day to zero', async () => {
    await addManual();
    const day = await assignedDay();
    const [item] = await items();
    await call({ action: 'remove', itemId: item.id });
    expect(await activeCount(day)).toBe(0);
    expect((await items()).length).toBe(0);
  });

  it('Cenário 2: deleting two of three leaves the day standing', async () => {
    await register();
    const day = await assignedDay();
    const all = await items();
    await call({ action: 'remove', itemId: all[0].id });
    await call({ action: 'remove', itemId: all[1].id });
    expect(await activeCount(day)).toBe(5);
    await Promise.all(all.slice(2).map(item => call({ action: 'remove', itemId: item.id })));
    // Cenário 4 continued: deleting all seven revokes the nutrition evidence.
    expect(await activeCount(day)).toBe(0);
    // Budget, not behaviour. Seven serialized `remove` transactions against a
    // single aggregate contend with each other by design, and the five
    // concurrent ones at the end retry under that contention. Isolated this
    // runs in ~5s; the default 10s budget is reached only when the rest of the
    // suite is competing for the same emulator. The assertions above are
    // unchanged — only the clock is.
  }, 30_000);

  it('Cenário 7 / F: moving between meals creates no activity and revokes none', async () => {
    await addManual();
    const day = await assignedDay();
    const [item] = await items();
    await call({ action: 'move', itemId: item.id, toSlot: 'lunch' });
    expect(await activeCount(day)).toBe(1);
    const moved = (await items('lunch'))[0];
    // Identity and temporal origin both survive the move.
    expect(moved.id).toBe(item.id);
    expect(moved.activityLocalDate).toBe(day);
    expect(moved.revision).toBe(1);
    const days = await user().collection(STREAK_NUTRITION_DAYS_COLLECTION).get();
    expect(days.size).toBe(1);
  });

  it('Cenário E: editing quantity creates no activity and keeps the original day', async () => {
    await addManual();
    const day = await assignedDay();
    const [item] = await items();
    await call({ action: 'edit', itemId: item.id, quantity: 250, expectedRevision: item.revision ?? 0 });
    expect(await activeCount(day)).toBe(1);
    const edited = (await items())[0];
    expect(edited.activityLocalDate).toBe(day);
    expect(edited.grams).toBe(250);
    expect(edited.revision).toBe(1);
  });

  it('Cenário 5: a deletion days later revokes the ORIGINAL day, not today', async () => {
    await addManual();
    const [item] = await items();
    // Rewrite the stored item's provenance to a past day — exactly the shape
    // a food logged on Monday has when deleted on Wednesday. The aggregate for
    // that past day is seeded to mirror the original creation.
    const pastDay = '2026-09-07';
    const itemRef = user().collection('nutritionDailyLogs').doc(diaryDate)
      .collection('meals').doc('breakfast').collection('items').doc(item.id);
    await itemRef.update({ activityLocalDate: pastDay });
    await user().collection(STREAK_NUTRITION_DAYS_COLLECTION).doc(pastDay)
      .set({ localDate: pastDay, activeItemCount: 1, timezone: TZ, schemaVersion: 1, updatedAt: Timestamp.now() });

    await call({ action: 'remove', itemId: item.id });
    expect(await activeCount(pastDay)).toBe(0);
  });

  it('bumps the revocation token only on decrements', async () => {
    await addManual();
    expect((await settings())?.nutritionRevocations).toBeUndefined();
    const [item] = await items();
    await call({ action: 'remove', itemId: item.id });
    expect((await settings())?.nutritionRevocations).toBe(1);
    await addManual();
    // A later creation must not move the token — only deletions can break history.
    expect((await settings())?.nutritionRevocations).toBe(1);
  });

  describe('adversarial — a bookkeeping defect stops the mutation, it is not clamped away', () => {
    it('refuses a decrement that would go below zero (duplicated decrement)', async () => {
      await addManual();
      const day = await assignedDay();
      await user().collection(STREAK_NUTRITION_DAYS_COLLECTION).doc(day).update({ activeItemCount: 0 });
      const [item] = await items();
      await expect(call({ action: 'remove', itemId: item.id })).rejects.toThrow('DIARY_INCONSISTENT');
      // Nothing was written: the item survives and the counter is untouched.
      expect((await items()).length).toBe(1);
      expect(await activeCount(day)).toBe(0);
    });

    it('refuses a decrement whose aggregate document vanished above the floor', async () => {
      await addManual();
      const day = await assignedDay();
      await user().collection(STREAK_NUTRITION_DAYS_COLLECTION).doc(day).delete();
      const [item] = await items();
      await expect(call({ action: 'remove', itemId: item.id })).rejects.toThrow('DIARY_INCONSISTENT');
      expect((await items()).length).toBe(1);
    });

    it('refuses to rebuild from a corrupted stored count, in either direction', async () => {
      await addManual();
      const day = await assignedDay();
      await user().collection(STREAK_NUTRITION_DAYS_COLLECTION).doc(day).update({ activeItemCount: -4 });
      await expect(addManual()).rejects.toThrow('DIARY_INCONSISTENT');
      const [item] = await items();
      await expect(call({ action: 'remove', itemId: item.id })).rejects.toThrow('DIARY_INCONSISTENT');
      // The corrupted value is left exactly as found — no silent repair.
      expect(await activeCount(day)).toBe(-4);
    });

    it('skips (never errors on) a legacy item whose activity day predates the counter', async () => {
      await addManual();
      const day = await assignedDay();
      const [item] = await items();
      const itemRef = user().collection('nutritionDailyLogs').doc(diaryDate)
        .collection('meals').doc('breakfast').collection('items').doc(item.id);
      // An item created long before the aggregate existed: its activity day is
      // below `nutritionEvidenceFrom`, so there is no credit to remove.
      await itemRef.update({ activityLocalDate: '2026-01-05' });
      await call({ action: 'remove', itemId: item.id });
      expect((await items()).length).toBe(0);
      // Today's own counter is untouched, and no phantom day was created.
      expect(await activeCount(day)).toBe(1);
      expect(await activeCount('2026-01-05')).toBeNull();
    });
  });

  it('preserves activityLocalDate through a move followed by an edit', async () => {
    await addManual();
    const day = await assignedDay();
    const [item] = await items();
    await call({ action: 'move', itemId: item.id, toSlot: 'lunch' });
    const moved = (await items('lunch'))[0];
    await call({ action: 'edit', itemId: item.id, quantity: 180, expectedRevision: moved.revision ?? 0 }, undefined, diaryDate)
      .catch(async () => {
        // `edit` addresses the item in its CURRENT slot, so retarget the call.
        await mutateNutritionDiaryV1Handler({
          auth: { uid },
          data: {
            requestId: randomUUID(), expectedUid: uid, localDate: diaryDate, timezone: TZ,
            slot: 'lunch', action: 'edit', itemId: item.id, quantity: 180,
            expectedRevision: moved.revision ?? 0,
          },
        } as CallableRequest, db);
      });
    const edited = (await items('lunch'))[0];
    expect(edited.activityLocalDate).toBe(day);
    expect(await activeCount(day)).toBe(1);
  });

  it('a replayed request neither double-counts nor re-credits a deleted item', async () => {
    const requestId = randomUUID();
    await addManual(requestId);
    const day = await assignedDay();
    expect(await activeCount(day)).toBe(1);
    const replay = await addManual(requestId);
    expect(replay.replayed).toBe(true);
    expect(await activeCount(day)).toBe(1);

    // Cenário K: delete the item, then replay the same request. The receipt
    // short-circuits before any aggregate write, so the day stays revoked and
    // the item is not resurrected.
    const [item] = await items();
    await call({ action: 'remove', itemId: item.id });
    expect(await activeCount(day)).toBe(0);
    const secondReplay = await addManual(requestId);
    expect(secondReplay.replayed).toBe(true);
    expect(await activeCount(day)).toBe(0);
    expect((await items()).length).toBe(0);
  });

  it('a second registration of the same option is deduped without a second credit', async () => {
    await register();
    const day = await assignedDay();
    expect(await activeCount(day)).toBe(7);
    const second = await register({}, randomUUID());
    expect(second.replayed).toBe(true);
    expect(await activeCount(day)).toBe(7);
    expect((await items()).length).toBe(7);
  });

  it('two different diary dates logged on the same real day share one activity day', async () => {
    await addManual(undefined, '2026-10-18');
    await addManual(undefined, '2026-10-11');
    const days = await user().collection(STREAK_NUTRITION_DAYS_COLLECTION).get();
    expect(days.size).toBe(1);
    expect(days.docs[0].get('activeItemCount')).toBe(2);
  });

  it('falls back to loggedAt for a legacy item with no activityLocalDate', async () => {
    await addManual();
    const day = await assignedDay();
    const [item] = await items();
    const itemRef = user().collection('nutritionDailyLogs').doc(diaryDate)
      .collection('meals').doc('breakfast').collection('items').doc(item.id);
    // Exactly the shape of an item written before this field existed.
    await itemRef.update({ activityLocalDate: FieldValueDelete() });
    await call({ action: 'remove', itemId: item.id });
    // `loggedAt` is the server instant, so the same day is debited.
    expect(await activeCount(day)).toBe(0);
  });

  it('a disabled switch writes no aggregate and no settings for a fresh account', async () => {
    vi.stubEnv('NUTRITION_PLAN_SNAPSHOT_ENABLED', 'false');
    await expect(register()).rejects.toThrow('DIARY_FEATURE_DISABLED');
    expect((await user().collection(STREAK_NUTRITION_DAYS_COLLECTION).get()).empty).toBe(true);
    expect(await settings()).toBeNull();
  });

  it('account cleanup removes the aggregate and the streak settings', async () => {
    await addManual();
    expect((await user().collection(STREAK_NUTRITION_DAYS_COLLECTION).get()).empty).toBe(false);
    await deleteUserNutritionResources(uid, db);
    expect((await user().collection(STREAK_NUTRITION_DAYS_COLLECTION).get()).empty).toBe(true);
    expect((await user().collection(STREAK_SETTINGS_COLLECTION).get()).empty).toBe(true);
    expect((await user().collection(DIARY_RECEIPTS_COLLECTION).get()).empty).toBe(true);
  });

  it('honours an already-pinned timezone instead of the request’s', async () => {
    await user().collection(STREAK_SETTINGS_COLLECTION).doc(STREAK_SETTINGS_DOC_ID)
      .set({ timezone: 'Pacific/Kiritimati', schemaVersion: 1, createdAt: Timestamp.now() });
    await addManual();
    const stored = await settings();
    expect(stored?.timezone).toBe('Pacific/Kiritimati');
    // UTC+14 can legitimately be a day ahead of the request's UTC-3 zone.
    const day = await assignedDay();
    expect(await activeCount(day)).toBe(1);
  });
});

/** Local helper so the test file does not import admin FieldValue at module scope. */
function FieldValueDelete() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  return require('firebase-admin/firestore').FieldValue.delete();
}
