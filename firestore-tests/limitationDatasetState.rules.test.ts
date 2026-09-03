/**
 * Firestore Rules — `limitationDatasetState/{stateId}`.
 *
 * Bugfix regression (first-app-entry `INVALID_CONFIGURATION`): this document
 * holds ONLY the active clinical dataset's version string + content hash —
 * never clinical/PII content itself (that lives in `exercises/{id}`, which
 * keeps the stronger `hasVerifiedEmailForPrivateAccess()` gate — see
 * `exercises.rules.test.ts`). Every workout program generation
 * (`prepareWorkoutProgram` → `loadExerciseCatalogForLimitations`) reads this
 * document to stamp `limitationDatasetVersion`/`limitationDatasetHash` on
 * the plan, REGARDLESS of whether the user has any limitations at all.
 * Gating it behind email verification blocked first-program generation for
 * every signed-in-but-not-yet-verified Email/Password account — a normal,
 * legitimate state right after signup — and the resulting permission-denied
 * was converted into a misleading `INVALID_CONFIGURATION` by
 * `workoutPrograms.ts`. The fix widens this ONE document's read gate to
 * `isSignedIn()`; `exercises` must NOT be affected (see the negative test
 * below).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'ajfit-rules-test';
const DATASET_VERSION = 'phase3-limitation-dataset-v3';
const DATASET_HASH = '21ce79bcb57802df8a6072e933942b02ea34ba1d9ab85f0dc091395bff0f3944';
const EXERCISE_ID = 'barbell-back-squat';

let testEnv: RulesTestEnvironment;

function passwordDb(verified: boolean) {
  return testEnv.authenticatedContext('alice', {
    email_verified: verified,
    firebase: { identities: { email: ['alice@example.com'] }, sign_in_provider: 'password' },
  }).firestore();
}

async function seedActiveIdentity() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'limitationDatasetState', 'active'), {
      datasetVersion: DATASET_VERSION,
      limitationDatasetHash: DATASET_HASH,
    });
  });
}

async function seedClinicalExercise() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'exercises', EXERCISE_ID), {
      id: EXERCISE_ID,
      slug: EXERCISE_ID,
      name: { ptBR: 'Agachamento Livre', en: 'Barbell Back Squat', es: 'Sentadilla Libre con Barra' },
      status: 'active',
      difficulty: 'intermediate',
      metadata: { version: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
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

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedActiveIdentity();
  await seedClinicalExercise();
});

describe('limitationDatasetState/active — read', () => {
  it('(1) allows a signed-in, NOT-yet-verified Email/Password user to read the active identity', async () => {
    await assertSucceeds(getDoc(doc(passwordDb(false), 'limitationDatasetState', 'active')));
  });

  it('(2) allows a signed-in, verified user to read the active identity', async () => {
    await assertSucceeds(getDoc(doc(passwordDb(true), 'limitationDatasetState', 'active')));
  });

  it('(3) blocks an unauthenticated user from reading the active identity', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'limitationDatasetState', 'active')));
  });

  it('blocks reading any id other than "active", even when signed in', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'limitationDatasetState', 'draft'), {
        datasetVersion: DATASET_VERSION,
        limitationDatasetHash: DATASET_HASH,
      });
    });
    await assertFails(getDoc(doc(passwordDb(true), 'limitationDatasetState', 'draft')));
  });
});

describe('limitationDatasetState/active — write (server-only contract unchanged)', () => {
  it('(5) blocks a signed-in, verified user from writing the active identity', async () => {
    await assertFails(
      setDoc(doc(passwordDb(true), 'limitationDatasetState', 'active'), {
        datasetVersion: 'tampered', limitationDatasetHash: 'a'.repeat(64),
      }),
    );
  });

  it('(5) blocks a signed-in, verified user from updating the active identity', async () => {
    await assertFails(
      updateDoc(doc(passwordDb(true), 'limitationDatasetState', 'active'), { datasetVersion: 'tampered' }),
    );
  });

  it('(5) blocks a signed-in, verified user from deleting the active identity', async () => {
    await assertFails(deleteDoc(doc(passwordDb(true), 'limitationDatasetState', 'active')));
  });
});

describe('(4) widening limitationDatasetState/active read does NOT widen clinical exercises access', () => {
  it('a not-yet-verified user can read the dataset identity but still cannot read clinical exercises', async () => {
    const db = passwordDb(false);
    await assertSucceeds(getDoc(doc(db, 'limitationDatasetState', 'active')));
    await assertFails(getDoc(doc(db, 'exercises', EXERCISE_ID)));
  });

  it('a verified user can read both the dataset identity and clinical exercises (unchanged)', async () => {
    const db = passwordDb(true);
    await assertSucceeds(getDoc(doc(db, 'limitationDatasetState', 'active')));
    await assertSucceeds(getDoc(doc(db, 'exercises', EXERCISE_ID)));
  });
});
