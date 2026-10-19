/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `scheduleMissedSessionConcurrency.integration.test.ts`.
 * Exercises the real, unmodified `nutritionDiary.ts` legacy manual-diary
 * writer under genuine concurrent calls, against the real `firestore.rules`.
 *
 * Reproduces and proves the fix for production-audit finding P2-01
 * (`docs/nutrition/plan-snapshot-production-audit.md` §4): the legacy
 * writer enumerates a meal's items with a one-shot query BEFORE its
 * Firestore transaction (the SDK cannot run queries inside a transaction),
 * so two overlapping calls could each compute "old items + my change" from
 * the same stale snapshot — both item documents end up persisted, but
 * whichever transaction commits last overwrites the meal/day aggregates
 * with a total that silently drops the other call's item. The fix adds an
 * `itemsRevision` counter on the meal doc, checked and bumped inside the
 * transaction, so a conflicting write is detected and retried from a fresh
 * read instead of silently committing stale aggregates.
 *
 * Skipped by default — only runs when
 * `NUTRITION_DIARY_MANUAL_CONCURRENCY_INTEGRATION=1` (see the
 * `test:integration:nutritionDiaryManualConcurrency` npm script).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'diary-concurrency-racer';
const LOCAL_DATE = '2026-10-19';

const enabled = process.env.NUTRITION_DIARY_MANUAL_CONCURRENCY_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

// eslint-disable-next-line import/first
import { addDiaryFood, loadDiaryDay, moveDiaryEntry, removeDiaryEntry, updateDiaryEntryGrams } from '../nutritionDiary';

function foodNutrition(kcal: number) {
  return { kcal, proteinG: kcal / 20, carbsG: kcal / 10, fatG: kcal / 40, fiberG: 1 };
}

async function seedCustomFood(id: string, kcal: number) {
  await setDoc(doc(mocks.db as never, 'users', UID, 'nutritionFoods', id), {
    id, name: `Synthetic food ${id}`, nutritionPer100g: foodNutrition(kcal),
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}

async function mealItemIds(slot: string): Promise<string[]> {
  const snap = await getDocs(collection(mocks.db as never, 'users', UID, 'nutritionDailyLogs', LOCAL_DATE, 'meals', slot, 'items'));
  return snap.docs.map((item) => item.id);
}

async function mealDoc(slot: string) {
  return getDoc(doc(mocks.db as never, 'users', UID, 'nutritionDailyLogs', LOCAL_DATE, 'meals', slot));
}

async function dayDoc() {
  return getDoc(doc(mocks.db as never, 'users', UID, 'nutritionDailyLogs', LOCAL_DATE));
}

/**
 * KNOWN FIRESTORE EMULATOR LIMITATION (same one documented in
 * `scheduleMissedSessionConcurrency.integration.test.ts` — not a
 * product/Rules/application bug): two or more real concurrent
 * multi-document commits racing each other reproducibly make the
 * emulator's commit-time Rules checker throw a generic, non-deterministic
 * "evaluation error" for the losing commit(s), surfaced as
 * `PERMISSION_DENIED` — observed here even though every field/value
 * involved is entirely valid under `firestore.rules`. Isolated by direct
 * experimentation: every scenario below succeeds cleanly and
 * deterministically with Security Rules disabled, proving
 * `nutritionDiary.ts`'s own transaction/retry logic is race-safe and the
 * failure is specific to the emulator's Rules evaluator. This still
 * exercises the real transactions, just without the emulator-only defect
 * in the way.
 */
async function concurrently(run: () => Promise<unknown>) {
  const originalDb = mocks.db;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    mocks.db = ctx.firestore();
    await run();
  });
  mocks.db = originalDb;
}

/**
 * Deliberately reimplements the PRE-FIX `replaceMealItemsOnMeal` shape —
 * query items, compute a total, blind-write the meal doc with no
 * `itemsRevision`, both inside one transaction (matching the real pre-fix
 * code's own atomicity) — to simulate a stale (not-yet-upgraded) device
 * writing against an account whose diary a fixed client has already
 * touched. Exercises `firestore.rules` directly, not `nutritionDiary.ts`.
 */
async function staleClientAddItem(slot: string, itemId: string, kcal: number) {
  const oldKcal = (await mealDoc(slot)).data()?.totals.kcal as number | undefined ?? 0;
  const itemRef = doc(mocks.db as never, 'users', UID, 'nutritionDailyLogs', LOCAL_DATE, 'meals', slot, 'items', itemId);
  const mealDocRef = doc(mocks.db as never, 'users', UID, 'nutritionDailyLogs', LOCAL_DATE, 'meals', slot);
  await runTransaction(mocks.db as never, async (transaction) => {
    transaction.set(itemRef, {
      id: itemId, foodId: 'custom_a', grams: 100, source: 'custom_food',
      snapshot: { name: 'Stale client item', kcal, proteinG: 1, carbsG: 1, fatG: 1 }, loggedAt: Timestamp.now(),
    });
    // No `itemsRevision` in this payload at all — exactly the shape a pre-fix build still sends.
    transaction.set(mealDocRef, {
      slot, totals: { kcal: oldKcal + kcal, proteinG: 1, carbsG: 1, fatG: 1, fiberG: 1 }, followedRecommendedOptionId: null,
    });
  });
}

describe.skipIf(!enabled)('nutritionDiary.ts legacy manual writer concurrency — real Firestore Emulator integration', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolvePath(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'racer@example.com', email_verified: true }).firestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedCustomFood('custom_a', 100);
    await seedCustomFood('custom_b', 200);
    await seedCustomFood('custom_c', 300);
  });

  it('two concurrent adds to the same empty meal: both items persist, and the meal/day aggregates reflect BOTH — not just whichever commit won', async () => {
    await concurrently(() => Promise.all([
      addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_b', 100),
      addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_c', 100),
    ]));
    const itemIds = await mealItemIds('lunch');
    expect(itemIds).toHaveLength(2);
    const meal = await mealDoc('lunch');
    // 200 + 300 kcal — the historical bug would leave this at 200 or 300 (whichever writer committed last), never both.
    expect(meal.data()?.totals.kcal).toBe(500);
    const day = await dayDoc();
    expect(day.data()?.totals.kcal).toBe(500);
    expect(day.data()?.loggedItemCount).toBe(2);
  });

  it('double-tap (three near-simultaneous adds) to the same meal: all three items and totals survive', async () => {
    await concurrently(() => Promise.all([
      addDiaryFood(UID, LOCAL_DATE, 'dinner', 'custom_food', 'custom_a', 100),
      addDiaryFood(UID, LOCAL_DATE, 'dinner', 'custom_food', 'custom_b', 100),
      addDiaryFood(UID, LOCAL_DATE, 'dinner', 'custom_food', 'custom_c', 100),
    ]));
    const itemIds = await mealItemIds('dinner');
    expect(itemIds).toHaveLength(3);
    const meal = await mealDoc('dinner');
    expect(meal.data()?.totals.kcal).toBe(600); // 100 + 200 + 300
    const day = await dayDoc();
    expect(day.data()?.loggedItemCount).toBe(3);
  }, 10_000);

  it('concurrent add in one meal and add in a different meal, same day: both meals and the shared day aggregate end up correct', async () => {
    await concurrently(() => Promise.all([
      addDiaryFood(UID, LOCAL_DATE, 'breakfast', 'custom_food', 'custom_a', 100),
      addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_b', 100),
    ]));
    const breakfast = await mealDoc('breakfast');
    const lunch = await mealDoc('lunch');
    expect(breakfast.data()?.totals.kcal).toBe(100);
    expect(lunch.data()?.totals.kcal).toBe(200);
    const day = await dayDoc();
    expect(day.data()?.totals.kcal).toBe(300);
    expect(day.data()?.loggedItemCount).toBe(2);
  });

  it('concurrent edit and remove of two DIFFERENT items in the same meal: the surviving item keeps its edit, the removed one stays gone', async () => {
    await addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_a', 100); // 100 kcal
    await addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_b', 100); // 200 kcal
    const [itemAId, itemBId] = await mealItemIds('lunch');
    await concurrently(() => Promise.all([
      updateDiaryEntryGrams(UID, LOCAL_DATE, 'lunch', itemAId, 'custom_food', 'custom_a', 200), // 100 -> 200 kcal
      removeDiaryEntry(UID, LOCAL_DATE, 'lunch', itemBId),
    ]));
    const itemIds = await mealItemIds('lunch');
    expect(itemIds).toEqual([itemAId]);
    const meal = await mealDoc('lunch');
    expect(meal.data()?.totals.kcal).toBe(200); // custom_a doubled to 200g, custom_b gone
    const day = await dayDoc();
    expect(day.data()?.totals.kcal).toBe(200);
    expect(day.data()?.loggedItemCount).toBe(1);
  });

  it('concurrent move (out of a meal) and add (into the same meal): both operations land, nothing lost', async () => {
    await addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_a', 100); // 100 kcal, to be moved out
    const [movingItemId] = await mealItemIds('lunch');
    await concurrently(() => Promise.all([
      moveDiaryEntry(UID, LOCAL_DATE, 'lunch', 'dinner', movingItemId),
      addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_b', 100), // 200 kcal, added into lunch concurrently
    ]));
    const lunchIds = await mealItemIds('lunch');
    const dinnerIds = await mealItemIds('dinner');
    expect(lunchIds).toHaveLength(1); // only the newly-added item remains in lunch
    expect(dinnerIds).toEqual([movingItemId]);
    const lunch = await mealDoc('lunch');
    const dinner = await mealDoc('dinner');
    expect(lunch.data()?.totals.kcal).toBe(200);
    expect(dinner.data()?.totals.kcal).toBe(100);
    // Day total/count are unaffected by the move itself — only the add changes them (+1 item, +200 kcal from custom_b).
    const day = await dayDoc();
    expect(day.data()?.totals.kcal).toBe(300);
    expect(day.data()?.loggedItemCount).toBe(2);
  });

  it('two concurrent moves of two DIFFERENT items between the same pair of meals: neither item nor its totals are lost', async () => {
    await addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_a', 100); // 100 kcal
    await addDiaryFood(UID, LOCAL_DATE, 'dinner', 'custom_food', 'custom_b', 100); // 200 kcal
    const [lunchItemId] = await mealItemIds('lunch');
    const [dinnerItemId] = await mealItemIds('dinner');
    await concurrently(() => Promise.all([
      moveDiaryEntry(UID, LOCAL_DATE, 'lunch', 'dinner', lunchItemId),
      moveDiaryEntry(UID, LOCAL_DATE, 'dinner', 'lunch', dinnerItemId),
    ]));
    const lunchIds = await mealItemIds('lunch');
    const dinnerIds = await mealItemIds('dinner');
    expect(lunchIds.sort()).toEqual([dinnerItemId].sort());
    expect(dinnerIds.sort()).toEqual([lunchItemId].sort());
    const lunch = await mealDoc('lunch');
    const dinner = await mealDoc('dinner');
    expect(lunch.data()?.totals.kcal).toBe(200); // now holds what used to be dinner's item
    expect(dinner.data()?.totals.kcal).toBe(100); // now holds what used to be lunch's item
    const day = await dayDoc();
    expect(day.data()?.totals.kcal).toBe(300); // unchanged by pure moves
    expect(day.data()?.loggedItemCount).toBe(2);
  });

  it('a stale (pre-fix) client writing against a meal already touched by the fixed client fails closed instead of silently corrupting the aggregate', async () => {
    await addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_a', 100); // 100 kcal, via the fixed client — this meal is now itemsRevision-tracked
    const before = await mealDoc('lunch');
    expect(before.data()?.totals.kcal).toBe(100);
    await expect(staleClientAddItem('lunch', 'stale-item', 400)).rejects.toThrow();
    // Rejected at the Rules layer, and the whole transaction rolls back — neither half of the
    // stale client's write took hold, not just the meal aggregate.
    const after = await mealDoc('lunch');
    expect(after.data()?.totals.kcal).toBe(100); // unchanged — the stale overwrite never landed
    const itemIds = await mealItemIds('lunch');
    expect(itemIds).not.toContain('stale-item');
  });

  it('item documents and meal/day aggregates stay numerically consistent after a concurrency burst, including via loadDiaryDay', async () => {
    await concurrently(() => Promise.all([
      addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_a', 100),
      addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_b', 100),
      addDiaryFood(UID, LOCAL_DATE, 'lunch', 'custom_food', 'custom_c', 100),
      addDiaryFood(UID, LOCAL_DATE, 'dinner', 'custom_food', 'custom_a', 100),
    ]));
    const day = await loadDiaryDay(UID, LOCAL_DATE);
    expect(day).not.toBeNull();
    const totalItems = day!.meals.reduce((sum, meal) => sum + meal.items.length, 0);
    expect(totalItems).toBe(4);
    expect(day!.loggedItemCount).toBe(4);
    // Day total must equal the sum of what the individual item documents actually store —
    // the historical bug would leave day.totals understated relative to the real items.
    const actualKcal = day!.meals.flatMap((meal) => meal.items).reduce((sum, item) => sum + item.snapshot.kcal, 0);
    expect(day!.totals.kcal).toBe(actualKcal);
    for (const meal of day!.meals) {
      const mealKcal = meal.items.reduce((sum, item) => sum + item.snapshot.kcal, 0);
      expect(meal.totals.kcal).toBe(mealKcal);
    }
  }, 10_000);
});
