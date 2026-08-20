/**
 * Firestore Rules — behavioral tests for `metadata.commercialGateResolvedAt`
 * (initial-Paywall marker — see the `UserProfile.metadata` doc comment in
 * src/services/userProfile.ts). Proves the invariant the client-side gate
 * (`src/lib/premiumGate.ts`) depends on for security, not just UX: a client
 * can write this field as `null` at account creation (and only then), and
 * can NEVER write a resolved value itself — only the Admin SDK
 * (`functions/src/billing/subscriptionSync.ts`, which bypasses these Rules)
 * can transition it to a Timestamp.
 *
 * Executed against the Firestore emulator. See the `test:rules` npm script.
 */
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';

let testEnv: RulesTestEnvironment;

function ownerDb() {
  return testEnv.authenticatedContext(UID, { email: 'alice@example.com' }).firestore();
}

function newUserDoc(overrides: Record<string, unknown> = {}) {
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

/** Simulates a pre-existing (legacy, pre-field) document — Admin SDK, bypasses rules. */
async function seedLegacyUser(uid = UID) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      profile: { name: 'Legacy', email: 'alice@example.com' },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
      // No commercialGateResolvedAt key at all.
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
});

describe('commercialGateResolvedAt — account creation', () => {
  it('allows the client to create a new account with commercialGateResolvedAt explicitly null', async () => {
    await assertSucceeds(setDoc(doc(ownerDb(), 'users', UID), newUserDoc()));
  });

  it('rejects a client trying to fabricate an already-resolved gate at creation time', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), 'users', UID), newUserDoc({ commercialGateResolvedAt: Timestamp.now() })),
    );
  });

  it('rejects creation with the field omitted entirely (every new doc must explicitly mark itself pending)', async () => {
    const withoutField = newUserDoc();
    const metadata = withoutField.metadata as Record<string, unknown>;
    delete metadata.commercialGateResolvedAt;
    await assertFails(setDoc(doc(ownerDb(), 'users', UID), withoutField));
  });
});

describe('commercialGateResolvedAt — legacy documents (predate the field)', () => {
  it('a legacy document with the field absent remains fully readable by its owner', async () => {
    await seedLegacyUser(UID);
    await assertSucceeds(getDoc(doc(ownerDb(), 'users', UID)));
  });
});

describe('commercialGateResolvedAt — client can never resolve it after creation', () => {
  it('rejects a client update that sets commercialGateResolvedAt to a Timestamp', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID), newUserDoc());
    });
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'metadata.commercialGateResolvedAt': serverTimestamp(),
      }),
    );
  });

  it('an ordinary profile-field update (already allowed) leaves commercialGateResolvedAt untouched by construction — metadata diff stays restricted to updatedAt', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID), newUserDoc());
    });
    // The existing `update` rule only allows `metadata.updatedAt` to change
    // — this profile-name update must still succeed, proving the new field
    // didn't tighten or loosen anything about the pre-existing allowed path.
    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'profile.name': 'Alice Updated',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });
});
