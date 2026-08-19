/**
 * Firestore Rules — `_mfaRecovery/{recoverySetId}` must be unreachable from
 * every client, in every direction.
 *
 * This collection holds the keyed digests of a user's MFA recovery codes
 * (functions/src/mfaRecovery/schema.ts). The threat model for recovery
 * explicitly includes a COMPROMISED FIRST FACTOR — a stolen password, or a
 * hijacked Google/Apple account — so "the owner can read it" would defeat the
 * entire mechanism. That is why the owner is tested here alongside the
 * anonymous and the unrelated user, and why all three must be denied
 * identically.
 *
 * Executed against the Firestore emulator. See the `test:rules` npm script
 * (wraps this file with `firebase emulators:exec --only firestore`, which
 * sets FIRESTORE_EMULATOR_HOST for `initializeTestEnvironment` to pick up).
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
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
} from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const OWNER_UID = 'alice';
const OTHER_UID = 'mallory';

const COLLECTION = '_mfaRecovery';
/** Document id is the code's 12-symbol selector, not the uid. */
const RECOVERY_SET_ID = '2W7K9XQF3MTB';

let testEnv: RulesTestEnvironment;

function anonymousDb() {
  return testEnv.unauthenticatedContext().firestore();
}
function ownerDb() {
  return testEnv
    .authenticatedContext(OWNER_UID, { email: 'alice@example.com' })
    .firestore();
}
function otherDb() {
  return testEnv
    .authenticatedContext(OTHER_UID, { email: 'mallory@example.com' })
    .firestore();
}

/** Seeds a recovery set bypassing rules, exactly as the Admin SDK would. */
async function seedRecoverySet() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), COLLECTION, RECOVERY_SET_ID), {
      schemaVersion: 1,
      recoverySetId: RECOVERY_SET_ID,
      uid: OWNER_UID,
      version: 1,
      pepperVersion: 1,
      digestVersion: 1,
      digestAlgorithm: 'HMAC-SHA-256',
      status: 'active',
      createdAt: new Date('2026-08-19T10:00:00Z'),
      rotatedAt: null,
      codes: [
        {
          id: 'code-1',
          // Structurally shaped like a digest; not derived from any real code.
          digest: Buffer.alloc(32, 1).toString('base64'),
          state: 'available',
          createdAt: new Date('2026-08-19T10:00:00Z'),
          reservedAt: null,
          consumedAt: null,
          operationId: null,
        },
      ],
      rateLimit: {
        attempts: 0,
        windowStartedAt: null,
        lastAttemptAt: null,
        blockedUntil: null,
      },
      activeOperation: null,
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
});

const contexts: readonly [string, () => ReturnType<typeof ownerDb>][] = [
  ['anonymous', anonymousDb],
  ['the owner of the recovery set', ownerDb],
  ['an unrelated authenticated user', otherDb],
];

describe('_mfaRecovery — every client is denied', () => {
  describe.each(contexts)('%s', (_label, getDb) => {
    it('cannot get an existing recovery set', async () => {
      await seedRecoverySet();

      await assertFails(getDoc(doc(getDb(), COLLECTION, RECOVERY_SET_ID)));
    });

    it('cannot get a non-existent recovery set', async () => {
      // Denied identically whether or not the document exists, so the rules
      // themselves cannot be used to probe for a selector.
      await assertFails(getDoc(doc(getDb(), COLLECTION, 'ZZZZZZZZZZZZ')));
    });

    it('cannot list the collection', async () => {
      await seedRecoverySet();

      await assertFails(getDocs(collection(getDb(), COLLECTION)));
    });

    it('cannot create a recovery set', async () => {
      await assertFails(
        setDoc(doc(getDb(), COLLECTION, RECOVERY_SET_ID), {
          uid: OWNER_UID,
          status: 'active',
        }),
      );
    });

    it('cannot update a recovery set', async () => {
      await seedRecoverySet();

      await assertFails(
        updateDoc(doc(getDb(), COLLECTION, RECOVERY_SET_ID), { status: 'rotated' }),
      );
    });

    it('cannot delete a recovery set', async () => {
      await seedRecoverySet();

      await assertFails(deleteDoc(doc(getDb(), COLLECTION, RECOVERY_SET_ID)));
    });

    it('cannot reach a subcollection under a recovery set', async () => {
      // The rule is recursive (`{document=**}`), so a future subcollection is
      // denied without anyone having to remember to add it.
      const nested = doc(getDb(), COLLECTION, RECOVERY_SET_ID, 'attempts', 'a1');

      await assertFails(getDoc(nested));
      await assertFails(setDoc(nested, { attempts: 1 }));
    });
  });
});

describe('_mfaRecovery — the owner has no privileged path', () => {
  it('denies the owner even when the document names them', async () => {
    await seedRecoverySet();

    // The uid is a FIELD, never the document id — there is no ownership
    // relationship for the rules to grant anything on.
    await assertFails(getDoc(doc(ownerDb(), COLLECTION, RECOVERY_SET_ID)));
    await assertFails(getDoc(doc(ownerDb(), COLLECTION, OWNER_UID)));
  });

  it('denies a document keyed by the caller uid, in case anyone assumes that shape', async () => {
    await assertFails(setDoc(doc(ownerDb(), COLLECTION, OWNER_UID), { uid: OWNER_UID }));
  });
});
