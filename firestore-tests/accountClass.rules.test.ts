/**
 * Firestore Rules — behavioral tests for `users/{uid}.metadata.accountClass`
 * (QA/Sandbox vs Production account-identity axis,
 * functions/src/lib/accountClassification.ts).
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
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';

let testEnv: RulesTestEnvironment;

function ownerDb() {
  return testEnv.authenticatedContext(UID, { email: 'alice@example.com' }).firestore();
}

function baseUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    profile: { name: 'Alice', email: 'alice@example.com' },
    preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
    subscription: {},
    metadata: {
      role: 'user',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      commercialGateResolvedAt: null,
      ...overrides,
    },
  };
}

async function seedUser(accountClass?: 'PRODUCTION' | 'INTERNAL_QA') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', UID), {
      profile: { name: 'Alice', email: 'alice@example.com' },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: {
        role: 'user',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        commercialGateResolvedAt: null,
        ...(accountClass ? { accountClass } : {}),
      },
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

describe('accountClass — creation', () => {
  it('rejects a client trying to self-assign accountClass at signup', async () => {
    await assertFails(setDoc(
      doc(ownerDb(), 'users', UID),
      baseUserDoc({ accountClass: 'PRODUCTION' }),
    ));
    await assertFails(setDoc(
      doc(ownerDb(), 'users', UID),
      baseUserDoc({ accountClass: 'INTERNAL_QA' }),
    ));
  });

  it('still allows ordinary account creation with no accountClass field', async () => {
    await assertSucceeds(setDoc(doc(ownerDb(), 'users', UID), baseUserDoc()));
  });
});

describe('accountClass — update (client can never change it)', () => {
  it('rejects any attempt to set or flip accountClass via update, PRODUCTION or INTERNAL_QA seed alike', async () => {
    await seedUser('PRODUCTION');
    await assertFails(updateDoc(doc(ownerDb(), 'users', UID), {
      'metadata.accountClass': 'INTERNAL_QA',
      'metadata.updatedAt': serverTimestamp(),
    }));

    await seedUser('INTERNAL_QA');
    await assertFails(updateDoc(doc(ownerDb(), 'users', UID), {
      'metadata.accountClass': 'PRODUCTION',
      'metadata.updatedAt': serverTimestamp(),
    }));
  });

  it('does NOT lock an INTERNAL_QA-classified owner out of their own unrelated profile edits', async () => {
    await seedUser('INTERNAL_QA');
    await assertSucceeds(updateDoc(doc(ownerDb(), 'users', UID), {
      'profile.name': 'Alice Renamed',
      'metadata.updatedAt': serverTimestamp(),
    }));
    const snapshot = await getDoc(doc(ownerDb(), 'users', UID));
    expect(snapshot.get('metadata.accountClass')).toBe('INTERNAL_QA');
    expect(snapshot.get('profile.name')).toBe('Alice Renamed');
  });

  it('does NOT lock a PRODUCTION-classified owner out of their own unrelated profile edits', async () => {
    await seedUser('PRODUCTION');
    await assertSucceeds(updateDoc(doc(ownerDb(), 'users', UID), {
      'preferences.language': 'en',
      'metadata.updatedAt': serverTimestamp(),
    }));
    expect((await getDoc(doc(ownerDb(), 'users', UID))).get('metadata.accountClass')).toBe('PRODUCTION');
  });
});

describe('accountClass — read', () => {
  it('the owner can read their own accountClass', async () => {
    await seedUser('INTERNAL_QA');
    const snapshot = await assertSucceeds(getDoc(doc(ownerDb(), 'users', UID)));
    expect(snapshot.get('metadata.accountClass')).toBe('INTERNAL_QA');
  });
});
