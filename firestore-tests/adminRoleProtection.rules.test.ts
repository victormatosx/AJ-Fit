import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

/**
 * `metadata.role` is the sole admin gate shared by every admin-only surface
 * (Support V2 case reads, `firestore-tests/supportV2.rules.test.ts`; the
 * exercise library, `firestore-tests/exercises.rules.test.ts`). This file
 * regression-locks that no client — new account or existing user — can ever
 * self-promote to `admin`, regardless of which admin surface that would
 * unlock. Previously lived in `support.rules.test.ts` alongside now-removed
 * Support V1 (`supportTickets`) coverage; renamed since nothing here is
 * support-specific.
 */

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
let env: RulesTestEnvironment;

function db(uid = UID) { return env.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore(); }

beforeAll(async () => { env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') } }); });
afterAll(async () => env.cleanup());
beforeEach(async () => env.clearFirestore());

async function seedUserRole(uid: string, role: 'user' | 'admin') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      profile: { name: role === 'admin' ? 'Support Admin' : 'Alice', email: `${uid}@example.com` },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: { role, createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
    });
  });
}

describe('account role protection', () => {
  it('prevents a regular user from promoting their own account', async () => {
    await seedUserRole(UID, 'user');
    await assertFails(updateDoc(doc(db(), 'users', UID), {
      'metadata.role': 'admin',
      'metadata.updatedAt': serverTimestamp(),
    }));
  });

  it('prevents account creation with an administrative role', async () => {
    const uid = 'self-proclaimed-admin';
    await assertFails(setDoc(doc(db(uid), 'users', uid), {
      profile: { name: 'Fake Admin', email: `${uid}@example.com` },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: {
        role: 'admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    }));
  });

  it('uses the mobile profile and preferences flows without changing its role', async () => {
    await seedUserRole('support-admin', 'admin');
    const admin = db('support-admin');
    const profile = doc(admin, 'users', 'support-admin');
    await assertSucceeds(updateDoc(profile, {
      'profile.name': 'Support Admin Renamed',
      'preferences.language': 'en',
      'preferences.units': 'imperial',
      'metadata.updatedAt': serverTimestamp(),
    }));
    expect((await getDoc(profile)).get('metadata.role')).toBe('admin');

    await assertFails(updateDoc(profile, {
      'metadata.role': 'user',
      'metadata.updatedAt': serverTimestamp(),
    }));
  });
});
