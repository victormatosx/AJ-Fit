/**
 * Firestore Rules — behavioral tests for the Acesso Premium Gratuito
 * Administrativo realtime invalidation signal.
 *
 * `entitlementSignals/{uid}` must be readable ONLY by its own owner (so
 * `SubscriptionContext` can listen for an administrative grant/revoke) and
 * writable by no client whatsoever (only the Admin SDK, via
 * `functions/src/adminUsers/adminFreeAccess.ts`'s `touchEntitlementSignal`).
 * `adminAccessGrants/{uid}` (the actual administrative audit trail — grant
 * state, `grantedBy`, `reason`, history) must remain fully inaccessible to
 * every client, including the owner, exactly like `promoCodes`/
 * `couponRedemptions`/`subscriptionTransactions`.
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
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const OTHER_UID = 'mallory';

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

async function seedEntitlementSignal(uid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'entitlementSignals', uid), { updatedAt: serverTimestamp() });
  });
}

async function seedAdminAccessGrant(uid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'adminAccessGrants', uid), {
      uid,
      state: 'granted',
      grantedBy: 'admin-uid-1',
      reason: 'teste interno',
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

describe('entitlementSignals/{uid} — read', () => {
  it('allows the owner to read their own signal', async () => {
    await seedEntitlementSignal(UID);
    await assertSucceeds(getDoc(doc(ownerDb(), 'entitlementSignals', UID)));
  });

  it('denies another authenticated user reading someone else\'s signal', async () => {
    await seedEntitlementSignal(UID);
    await assertFails(getDoc(doc(otherDb(), 'entitlementSignals', UID)));
  });

  it('denies an unauthenticated client reading any signal', async () => {
    await seedEntitlementSignal(UID);
    await assertFails(getDoc(doc(anonDb(), 'entitlementSignals', UID)));
  });

  it('allows the owner to read even when the document does not exist yet (empty read, not an error)', async () => {
    await assertSucceeds(getDoc(doc(ownerDb(), 'entitlementSignals', UID)));
  });
});

describe('entitlementSignals/{uid} — write', () => {
  it('denies the owner writing their own signal', async () => {
    await assertFails(setDoc(doc(ownerDb(), 'entitlementSignals', UID), { updatedAt: serverTimestamp() }));
  });

  it('denies another authenticated user writing to a different uid\'s signal', async () => {
    await assertFails(setDoc(doc(otherDb(), 'entitlementSignals', UID), { updatedAt: serverTimestamp() }));
  });

  it('denies an unauthenticated client writing any signal', async () => {
    await assertFails(setDoc(doc(anonDb(), 'entitlementSignals', UID), { updatedAt: serverTimestamp() }));
  });
});

describe('adminAccessGrants/{uid} — remains fully inaccessible to every client', () => {
  it('denies the owner reading their own administrative grant record', async () => {
    await seedAdminAccessGrant(UID);
    await assertFails(getDoc(doc(ownerDb(), 'adminAccessGrants', UID)));
  });

  it('denies another authenticated user reading it', async () => {
    await seedAdminAccessGrant(UID);
    await assertFails(getDoc(doc(otherDb(), 'adminAccessGrants', UID)));
  });

  it('denies the owner writing to it', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), 'adminAccessGrants', UID), { uid: UID, state: 'granted' }),
    );
  });

  it('denies reading the events subcollection', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'adminAccessGrants', UID, 'events', 'evt-1'), {
        type: 'grant',
        state: 'confirmed',
      });
    });
    await assertFails(getDoc(doc(ownerDb(), 'adminAccessGrants', UID, 'events', 'evt-1')));
  });
});
