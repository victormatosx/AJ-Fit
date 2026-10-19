import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, type Firestore } from 'firebase/firestore';

// Regression coverage for the published workout protection preserved during rollback.
// Every write targets only the local Rules emulator.
const UID = 'reconciliation-alice';
const OTHER = 'reconciliation-bob';
const PROGRAM = 'wpg_reconciliation';
const INSTANCE = 'wpi_reconciliation';
const DATE = '2026-10-18';
const PERFORMED = '2026-10-17';
let env: RulesTestEnvironment;
const client = (uid = UID) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const state = (db: Firestore, id = 'current') => doc(db, 'users', UID, 'workoutPrograms', PROGRAM, 'scheduleState', id);
const grant = (db: Firestore) => doc(db, 'users', UID, 'workoutLifecycleAuthorityGrants', 'current');
const cursor = (overrides: Record<string, unknown> = {}) => ({
  programId: PROGRAM, nextSessionIndex: 0, cursorDate: DATE,
  lastCompletedAt: null, pendingMissDecision: null, updatedAt: serverTimestamp(), ...overrides,
});
async function seedState(overrides: Record<string, unknown> = {}, id = 'current') {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(state(context.firestore() as unknown as Firestore, id), cursor(overrides));
  });
}
async function seedV2(withGrant = false) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'users', UID, 'programInstances', INSTANCE), { contentIdentity: PROGRAM });
    await setDoc(doc(db, 'users', UID, 'workoutLifecycleState', 'current'), { activeProgramInstanceId: INSTANCE });
    if (withGrant) await setDoc(grant(db), {
      uid: UID, schemaVersion: 1, operation: 'COMPLETE_SCHEDULE', sourceProgramInstanceId: INSTANCE,
      targetNextSessionIndex: 1, targetCursorDate: DATE, expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
  });
}
async function advanceV2(lastPerformedLocalDate: string) {
  const db = client();
  return runTransaction(db, async (tx) => {
    tx.update(state(db, INSTANCE), { nextSessionIndex: 1, lastPerformedLocalDate, updatedAt: serverTimestamp() });
    tx.delete(grant(db));
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'ajfit-rules-test',
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    for (const uid of [UID, OTHER]) await setDoc(doc(context.firestore(), 'users', uid), { owner: true });
  });
});

describe('preserves the published lastPerformedLocalDate protection', () => {
  it('keeps historical creation without the optional field compatible', async () => {
    await assertSucceeds(setDoc(state(client()), cursor()));
    expect((await getDoc(state(client()))).data()).not.toHaveProperty('lastPerformedLocalDate');
  });
  it('allows a fresh bootstrap with explicit null', async () => {
    await assertSucceeds(setDoc(state(client()), cursor({ lastPerformedLocalDate: null })));
  });
  it.each([PERFORMED, DATE, '2026-10-19', 42, false])('rejects client-assigned history on creation: %s', async (value) => {
    await assertFails(setDoc(state(client()), cursor({ lastPerformedLocalDate: value })));
    expect((await getDoc(state(client()))).exists()).toBe(false);
  });
  it('allows the existing whole-document legacy writer when it preserves backend history', async () => {
    await seedState({ lastPerformedLocalDate: PERFORMED });
    await assertSucceeds(setDoc(state(client()), cursor({ nextSessionIndex: 1, lastPerformedLocalDate: PERFORMED })));
    expect((await getDoc(state(client()))).get('lastPerformedLocalDate')).toBe(PERFORMED);
  });
  it.each([
    ['earlier day', '2026-10-16'], ['later day', DATE], ['null', null], ['field deletion', deleteField()],
  ])('rejects changing backend history through %s', async (_name, value) => {
    await seedState({ lastPerformedLocalDate: PERFORMED });
    await assertFails(updateDoc(state(client()), { lastPerformedLocalDate: value, updatedAt: serverTimestamp() }));
    expect((await getDoc(state(client()))).get('lastPerformedLocalDate')).toBe(PERFORMED);
  });
  it('rejects clearing stored history by omitting it from a whole-document set', async () => {
    await seedState({ lastPerformedLocalDate: PERFORMED });
    await assertFails(setDoc(state(client()), cursor()));
    expect((await getDoc(state(client()))).get('lastPerformedLocalDate')).toBe(PERFORMED);
  });
  it('preserves the remote equivalence of absent and null for old documents', async () => {
    const ref = state(client());
    await assertSucceeds(setDoc(ref, cursor()));
    await assertSucceeds(updateDoc(ref, { lastPerformedLocalDate: null, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { lastPerformedLocalDate: deleteField(), updatedAt: serverTimestamp() }));
  });
  it('denies another account even when the history is preserved', async () => {
    await seedState({ lastPerformedLocalDate: PERFORMED });
    await assertFails(getDoc(state(client(OTHER))));
    await assertFails(setDoc(state(client(OTHER)), cursor({ lastPerformedLocalDate: PERFORMED })));
  });
  it('keeps the account-deletion lock effective for a legitimate bookkeeping update', async () => {
    await seedState({ lastPerformedLocalDate: PERFORMED });
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'accountDeletionLocks', UID), { uid: UID });
    });
    await assertFails(updateDoc(state(client()), { updatedAt: serverTimestamp() }));
  });
  it('permits the null V2 bootstrap only under its actual instance identity', async () => {
    await seedV2();
    await assertSucceeds(setDoc(state(client(), INSTANCE), cursor({ programInstanceId: INSTANCE, lastPerformedLocalDate: null })));
    await assertFails(setDoc(state(client()), cursor({ lastPerformedLocalDate: null })));
  });
  it('allows same-position V2 bookkeeping with immutable history and no grant', async () => {
    await seedV2(); await seedState({ programInstanceId: INSTANCE, lastPerformedLocalDate: PERFORMED }, INSTANCE);
    await assertSucceeds(setDoc(state(client(), INSTANCE), cursor({ programInstanceId: INSTANCE, lastPerformedLocalDate: PERFORMED })));
  });
  it('still rejects a V2 advance without authority even with preserved history', async () => {
    await seedV2(); await seedState({ programInstanceId: INSTANCE, lastPerformedLocalDate: PERFORMED }, INSTANCE);
    await assertFails(updateDoc(state(client(), INSTANCE), { nextSessionIndex: 1, updatedAt: serverTimestamp() }));
  });
  it('allows the grant-backed V2 advance while preserving backend history', async () => {
    await seedV2(true); await seedState({ programInstanceId: INSTANCE, lastPerformedLocalDate: PERFORMED }, INSTANCE);
    await assertSucceeds(advanceV2(PERFORMED));
    expect((await getDoc(state(client(), INSTANCE))).get('nextSessionIndex')).toBe(1);
    await env.withSecurityRulesDisabled(async (context) => {
      expect((await getDoc(grant(context.firestore() as unknown as Firestore))).exists()).toBe(false);
    });
  });
  it('rejects a forged history even with a valid grant, without consuming that grant', async () => {
    await seedV2(true); await seedState({ programInstanceId: INSTANCE, lastPerformedLocalDate: PERFORMED }, INSTANCE);
    await assertFails(advanceV2(DATE));
    expect((await getDoc(state(client(), INSTANCE))).get('lastPerformedLocalDate')).toBe(PERFORMED);
    expect((await getDoc(state(client(), INSTANCE))).get('nextSessionIndex')).toBe(0);
    await env.withSecurityRulesDisabled(async (context) => {
      expect((await getDoc(grant(context.firestore() as unknown as Firestore))).exists()).toBe(true);
    });
  });
});

