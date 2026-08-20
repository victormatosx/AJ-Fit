/**
 * Firestore Rules — `exercises/{exerciseId}` (docs/27_biblioteca_de_exercicios.md).
 *
 * Executed against the Firestore emulator (`test:rules` npm script). Global
 * exercise library: readable by any signed-in user, never writable by a
 * client — only `scripts/seedExercises.ts` (Admin SDK, bypasses rules)
 * writes here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'ajfit-rules-test';
const EXERCISE_ID = 'barbell-back-squat';

let testEnv: RulesTestEnvironment;

function signedInDb() {
  return testEnv.authenticatedContext('alice').firestore();
}

async function seedExercise() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'exercises', EXERCISE_ID), {
      name: { ptBR: 'Agachamento Livre', en: 'Barbell Back Squat', es: 'Sentadilla Libre con Barra' },
      status: 'active',
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedExercise();
});

describe('exercises — read', () => {
  it('allows a signed-in user to read an exercise', async () => {
    await assertSucceeds(getDoc(doc(signedInDb(), 'exercises', EXERCISE_ID)));
  });

  it('blocks an unauthenticated user from reading an exercise', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'exercises', EXERCISE_ID)));
  });
});

describe('exercises — write', () => {
  it('blocks a signed-in user from updating an exercise', async () => {
    await assertFails(
      updateDoc(doc(signedInDb(), 'exercises', EXERCISE_ID), { status: 'inactive' }),
    );
  });

  it('blocks a signed-in user from creating a new exercise', async () => {
    await assertFails(
      setDoc(doc(signedInDb(), 'exercises', 'made-up-exercise'), { status: 'active' }),
    );
  });

  it('blocks a signed-in user from deleting an exercise', async () => {
    await assertFails(deleteDoc(doc(signedInDb(), 'exercises', EXERCISE_ID)));
  });

  it('blocks an unauthenticated user from writing an exercise', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(anon, 'exercises', EXERCISE_ID), { status: 'active' }));
  });
});
