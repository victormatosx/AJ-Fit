import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'weight-owner';
const OTHER_UID = 'weight-other';
const HASH = 'a'.repeat(64);
const SAMPLE_ID = `ios_${HASH}`;
let testEnv: RulesTestEnvironment;

function ownerDb() {
  return testEnv.authenticatedContext(UID, { email: 'owner@example.com' }).firestore();
}

function otherDb() {
  return testEnv.authenticatedContext(OTHER_UID, { email: 'other@example.com' }).firestore();
}

function validSample(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'ios',
    sourceId: 'external/uuid:with-path-hostile-characters',
    sourceApp: 'com.apple.Health',
    measuredAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    weightKg: 78.4,
    ...overrides,
  };
}

async function seedSample() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', UID, 'healthWeightSamples', SAMPLE_ID), {
      ...validSample(),
      measuredAt: Timestamp.now(),
      createdAt: Timestamp.now(),
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => testEnv.cleanup());
beforeEach(async () => testEnv.clearFirestore());

describe('healthWeightSamples rules', () => {
  it('allows the owner to create, read, list, and explicitly delete an imported weight', async () => {
    const ref = doc(ownerDb(), 'users', UID, 'healthWeightSamples', SAMPLE_ID);
    await assertSucceeds(setDoc(ref, validSample()));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(getDocs(collection(ownerDb(), 'users', UID, 'healthWeightSamples')));
    await assertSucceeds(deleteDoc(ref));
  });

  it('keeps documents immutable', async () => {
    await seedSample();
    await assertFails(updateDoc(
      doc(ownerDb(), 'users', UID, 'healthWeightSamples', SAMPLE_ID),
      { weightKg: 70 },
    ));
  });

  it('blocks cross-user reads, creates, and deletes', async () => {
    await seedSample();
    const target = doc(otherDb(), 'users', UID, 'healthWeightSamples', SAMPLE_ID);
    await assertFails(getDoc(target));
    await assertFails(setDoc(doc(otherDb(), 'users', UID, 'healthWeightSamples', `ios_${'b'.repeat(64)}`), validSample()));
    await assertFails(deleteDoc(target));
  });

  it('blocks all access after the account-deletion lock exists', async () => {
    await seedSample();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'accountDeletionLocks', UID), { createdAt: Timestamp.now() });
    });
    const existing = doc(ownerDb(), 'users', UID, 'healthWeightSamples', SAMPLE_ID);
    await assertFails(getDoc(existing));
    await assertFails(deleteDoc(existing));
    await assertFails(setDoc(
      doc(ownerDb(), 'users', UID, 'healthWeightSamples', `ios_${'e'.repeat(64)}`),
      validSample({ sourceId: 'new' }),
    ));
  });

  it.each([
    ['raw external id in path', 'ios_external_id', validSample()],
    ['wrong platform prefix', `android_${HASH}`, validSample()],
    ['short digest', 'ios_abc', validSample()],
    ['zero weight', SAMPLE_ID, validSample({ weightKg: 0 })],
    ['excessive weight', SAMPLE_ID, validSample({ weightKg: 500 })],
    ['empty source id', SAMPLE_ID, validSample({ sourceId: '' })],
    ['extra field', SAMPLE_ID, validSample({ height: 180 })],
    ['client-created timestamp', SAMPLE_ID, validSample({ createdAt: Timestamp.fromMillis(0) })],
    ['far-future measurement', SAMPLE_ID, validSample({ measuredAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000) })],
  ])('rejects invalid sample: %s', async (_label, id, payload) => {
    await assertFails(setDoc(doc(ownerDb(), 'users', UID, 'healthWeightSamples', id), payload));
  });

  it('accepts multiple legitimate samples on the same day because identity is per native record', async () => {
    const now = Timestamp.now();
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'users', UID, 'healthWeightSamples', `ios_${'c'.repeat(64)}`),
      validSample({ sourceId: 'uuid-1', measuredAt: now }),
    ));
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'users', UID, 'healthWeightSamples', `ios_${'d'.repeat(64)}`),
      validSample({ sourceId: 'uuid-2', measuredAt: now }),
    ));
    const result = await getDocs(collection(ownerDb(), 'users', UID, 'healthWeightSamples'));
    expect(result.size).toBe(2);
  });
});
