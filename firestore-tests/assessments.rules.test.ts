/**
 * Firestore Rules — behavioral tests for `users/{userId}/assessments/{id}`
 * (docs/03 §4/§8, docs/15 §10/§11/§18).
 *
 * FASE 7 (docs/13_assinaturas_e_billing.md §10/§11): CREATE_ASSESSMENT is a
 * Premium capability (Fase 3) — this is the first Rules test file this
 * collection has ever had, so it covers both the pre-existing schema/
 * ownership contract AND the new `hasServerPremium()` gate together.
 *
 * Executed against the Firestore emulator. See the `test:rules` npm script.
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const OTHER_UID = 'mallory';
const ASSESSMENT_ID = 'assessment-001';

let testEnv: RulesTestEnvironment;

function ownerDb() {
  return testEnv.authenticatedContext(UID, { email: 'alice@example.com' }).firestore();
}
function otherDb() {
  return testEnv.authenticatedContext(OTHER_UID, { email: 'mallory@example.com' }).firestore();
}
function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
}

function validGuided(overrides: Record<string, unknown> = {}) {
  return {
    source: 'guided',
    measuredAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    weight: 82.4,
    height: 178,
    bodyFat: 18.2,
    calculatorVersion: 1,
    protocol: 'jp7',
    sex: 'm',
    age: 29,
    folds: { chest: 12, abdominal: 18, thigh: 14, tricep: 9, subscapular: 11, suprailiac: 13, midaxillary: 10 },
    ...overrides,
  };
}

function validImported(overrides: Record<string, unknown> = {}) {
  return {
    source: 'imported',
    measuredAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    weight: 82.4,
    height: 178,
    ...overrides,
  };
}

async function seedPremium(uid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'users', uid),
      { subscription: { entitlementActive: true } },
      { merge: true },
    );
  });
}

async function seedFree(uid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'users', uid),
      { subscription: { entitlementActive: false } },
      { merge: true },
    );
  });
}

/** Seeds an existing assessment bypassing rules (baseline for read tests). */
async function seedAssessment(uid = UID, id = ASSESSMENT_ID, payload = validImported()) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid, 'assessments', id), {
      ...payload,
      measuredAt: Timestamp.now(),
      createdAt: Timestamp.now(),
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedPremium(UID);
  await seedPremium(OTHER_UID);
});

describe('assessments — Premium owner happy path', () => {
  it('allows a Premium owner to create a guided assessment', async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID), validGuided()),
    );
  });

  it('allows a Premium owner to create an imported assessment', async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID), validImported()),
    );
  });

  it('allows a Premium owner to read their own assessments', async () => {
    await seedAssessment();
    await assertSucceeds(getDoc(doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID)));
    await assertSucceeds(getDocs(collection(ownerDb(), 'users', UID, 'assessments')));
  });
});

describe('assessments — immutability (unchanged by Fase 7)', () => {
  beforeEach(() => seedAssessment());

  it('rejects updating an assessment, even for a Premium owner', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID), { weight: 80 }),
    );
  });

  it('rejects deleting an assessment, even for a Premium owner', async () => {
    await assertFails(deleteDoc(doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID)));
  });
});

describe('assessments — FASE 7: Free is denied the Premium mutation', () => {
  it('denies a Free owner creating a guided assessment', async () => {
    await seedFree(UID);
    await assertFails(
      setDoc(doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID), validGuided()),
    );
  });

  it('denies a Free owner creating an imported assessment', async () => {
    await seedFree(UID);
    await assertFails(
      setDoc(doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID), validImported()),
    );
  });

  it('fails closed when users/{uid} has no subscription field at all', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`users/${UID}`).delete();
      await ctx.firestore().doc(`users/${UID}`).set({ profile: { name: 'Alice', email: 'a@example.com' } });
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID), validImported()),
    );
  });

  it("still allows a Free owner to READ their existing assessment history (history is never blocked)", async () => {
    await seedAssessment();
    await seedFree(UID);
    await assertSucceeds(getDoc(doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID)));
    await assertSucceeds(getDocs(collection(ownerDb(), 'users', UID, 'assessments')));
  });
});

describe('assessments — FASE 7: Premium never overrides ownership', () => {
  it("denies a Premium user creating an assessment under someone else's uid", async () => {
    await assertFails(
      setDoc(doc(otherDb(), 'users', UID, 'assessments', ASSESSMENT_ID), validGuided()),
    );
  });

  it("denies a Premium user reading someone else's assessment history", async () => {
    await seedAssessment();
    await assertFails(getDoc(doc(otherDb(), 'users', UID, 'assessments', ASSESSMENT_ID)));
    await assertFails(getDocs(collection(otherDb(), 'users', UID, 'assessments')));
  });
});

describe('assessments — unauthenticated', () => {
  it('blocks unauthenticated creates regardless of any Premium state', async () => {
    await assertFails(
      setDoc(doc(anonDb(), 'users', UID, 'assessments', ASSESSMENT_ID), validGuided()),
    );
  });

  it('blocks unauthenticated reads', async () => {
    await seedAssessment();
    await assertFails(getDoc(doc(anonDb(), 'users', UID, 'assessments', ASSESSMENT_ID)));
  });
});

describe('assessments — schema is still enforced alongside Premium (unchanged by Fase 7)', () => {
  it('rejects a guided assessment missing required fields even for a Premium owner', async () => {
    const { protocol: _omitted, ...incomplete } = validGuided();
    await assertFails(
      setDoc(doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID), incomplete),
    );
  });

  it('rejects an unknown source even for a Premium owner', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID),
        validImported({ source: 'manual' }),
      ),
    );
  });

  it('rejects a forged createdAt even for a Premium owner', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'users', UID, 'assessments', ASSESSMENT_ID),
        validImported({ createdAt: Timestamp.now() }),
      ),
    );
  });
});
