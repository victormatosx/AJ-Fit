import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'email-verification-user';
const EMAIL = 'person@example.com';
let testEnv: RulesTestEnvironment;

function passwordDb(verified: boolean) {
  return testEnv.authenticatedContext(UID, {
    email: EMAIL,
    email_verified: verified,
    firebase: { identities: { email: [EMAIL] }, sign_in_provider: 'password' },
  }).firestore();
}

function userData() {
  return {
    profile: { name: 'Test User', email: EMAIL },
    preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
    subscription: {},
    metadata: {
      role: 'user',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      commercialGateResolvedAt: null,
    },
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => testEnv.cleanup());
beforeEach(async () => testEnv.clearFirestore());

describe('Email/Password verification boundary', () => {
  it('allows only the minimum unverified provisioning batch and gate reads', async () => {
    const db = passwordDb(false);
    const user = doc(db, 'users', UID);
    const questionnaire = doc(db, 'users', UID, 'questionnaires', 'initial');
    const batch = writeBatch(db);
    batch.set(user, userData());
    batch.set(questionnaire, { answers: { goal: 'health' }, version: 1, createdAt: serverTimestamp() });

    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(user));
    await assertSucceeds(getDoc(questionnaire));
    await assertFails(setDoc(doc(db, 'users', UID, 'questionnaires', 'later'), {
      answers: { goal: 'strength' }, version: 1, createdAt: serverTimestamp(),
    }));
  });

  it('allows a verified owner to create a later questionnaire', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID), {
        profile: { name: 'Test User', email: EMAIL },
        preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
        subscription: {},
        metadata: { role: 'user', createdAt: new Date(), updatedAt: new Date() },
      });
    });
    await assertSucceeds(setDoc(doc(passwordDb(true), 'users', UID, 'questionnaires', 'later'), {
      answers: { goal: 'strength' }, version: 1, createdAt: serverTimestamp(),
    }));
  });
});
