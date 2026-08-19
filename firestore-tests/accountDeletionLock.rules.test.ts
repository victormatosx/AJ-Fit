/**
 * Firestore Rules — behavioral tests for `accountActive(userId)` (Fase 5,
 * docs/25_exclusao_de_conta_arquitetura.md — "Bloqueio imediato da conta").
 *
 * Proves the property Fase 5 §39 calls the obligatory gate: an ID token
 * that is still cryptographically valid (this is exactly what the
 * emulator's `authenticatedContext` simulates — a token the Firestore SDK
 * accepts) must NOT be able to read or write private user-owned data once
 * `accountDeletionLocks/{uid}` exists, regardless of the lock's internal
 * `status`.
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
import { doc, setDoc, updateDoc, getDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

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

async function seedUser(uid = UID) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      profile: { name: 'Alice', email: 'alice@example.com' },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: { entitlementActive: true },
      metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
    });
  });
}

async function seedQuestionnaire(uid = UID) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid, 'questionnaires', 'q1'), {
      answers: { goal: 'lose_weight' },
      version: 1,
      createdAt: Timestamp.now(),
    });
  });
}

async function seedAssessment(uid = UID) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid, 'assessments', 'a1'), {
      source: 'imported',
      measuredAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      weight: 80,
      height: 178,
    });
  });
}

async function seedProgressPhoto(uid = UID) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid, 'progressPhotos', 'p1'), {
      storagePath: `users/${uid}/progressPhotos/p1.enc`,
      createdAt: Timestamp.now(),
      takenAt: Timestamp.now(),
      originalMimeType: 'image/jpeg',
      encryptedSize: 1000,
      encryption: { version: 1, algorithm: 'AES-256-GCM', iv: 'AAAAAAAAAAAAAAAA', vaultKeyVersion: 1 },
    });
  });
}

/** Simulates `requestAccountDeletion` having accepted a deletion — Admin SDK, bypasses rules. */
async function seedLock(uid = UID, status: string = 'REQUESTED') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'accountDeletionLocks', uid), {
      uid,
      activeDeletionId: 'del-1',
      status,
      revision: 0,
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
  await seedUser(UID);
  await seedUser(OTHER_UID);
});

describe('accountActive — active account (no lock) — unchanged baseline', () => {
  it('allows the owner to read users/{uid}', async () => {
    await assertSucceeds(getDoc(doc(ownerDb(), 'users', UID)));
  });

  it('allows the owner to update an editable profile field', async () => {
    await assertSucceeds(updateDoc(doc(ownerDb(), 'users', UID), { 'metadata.updatedAt': serverTimestamp() }));
  });

  it('allows reading questionnaires/assessments/progressPhotos', async () => {
    await seedQuestionnaire();
    await seedAssessment();
    await seedProgressPhoto();
    await assertSucceeds(getDoc(doc(ownerDb(), 'users', UID, 'questionnaires', 'q1')));
    await assertSucceeds(getDoc(doc(ownerDb(), 'users', UID, 'assessments', 'a1')));
    await assertSucceeds(getDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', 'p1')));
  });
});

describe.each(['REQUESTED', 'PROCESSING', 'RETRY_SCHEDULED', 'COMPLETED', 'FAILED_TERMINAL'])(
  'accountActive — locked account (status=%s) — every private path denied',
  (status) => {
    beforeEach(async () => {
      await seedQuestionnaire();
      await seedAssessment();
      await seedProgressPhoto();
      await seedLock(UID, status);
    });

    it('denies reading users/{uid}', async () => {
      await assertFails(getDoc(doc(ownerDb(), 'users', UID)));
    });

    it('denies updating users/{uid}', async () => {
      await assertFails(updateDoc(doc(ownerDb(), 'users', UID), { 'metadata.updatedAt': serverTimestamp() }));
    });

    it('denies creating a NEW users/{uid} document (no resurrecting a cleaned-up profile)', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await deleteDoc(doc(ctx.firestore(), 'users', UID));
      });
      await assertFails(
        setDoc(doc(ownerDb(), 'users', UID), {
          profile: { name: 'Alice', email: 'alice@example.com' },
          preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
          subscription: {},
          metadata: { role: 'user', createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
        }),
      );
    });

    it('denies reading questionnaires/assessments/progressPhotos', async () => {
      await assertFails(getDoc(doc(ownerDb(), 'users', UID, 'questionnaires', 'q1')));
      await assertFails(getDoc(doc(ownerDb(), 'users', UID, 'assessments', 'a1')));
      await assertFails(getDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', 'p1')));
    });

    it('denies deleting a progress photo', async () => {
      await assertFails(deleteDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', 'p1')));
    });

    it('denies creating a new assessment/questionnaire/progressPhoto', async () => {
      await assertFails(
        setDoc(doc(ownerDb(), 'users', UID, 'questionnaires', 'q2'), {
          answers: {},
          version: 1,
          createdAt: serverTimestamp(),
        }),
      );
      await assertFails(
        setDoc(doc(ownerDb(), 'users', UID, 'assessments', 'a2'), {
          source: 'imported',
          measuredAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          weight: 80,
          height: 178,
        }),
      );
    });
  },
);

describe('accountActive — lock document itself is never client-accessible', () => {
  it('denies the owner reading their own lock document', async () => {
    await seedLock(UID);
    await assertFails(getDoc(doc(ownerDb(), 'accountDeletionLocks', UID)));
  });

  it('denies the owner writing/forging their own lock document to appear inactive... i.e. active', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), 'accountDeletionLocks', UID), {
        uid: UID,
        activeDeletionId: 'fake',
        status: 'COMPLETED',
        revision: 0,
      }),
    );
  });

  it('denies the owner deleting their own lock document to un-lock the account', async () => {
    await seedLock(UID);
    await assertFails(deleteDoc(doc(ownerDb(), 'accountDeletionLocks', UID)));
  });

  it('denies reading/writing the accountDeletions record itself', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'accountDeletions', 'del-1'), { uid: UID, status: 'REQUESTED' });
    });
    await assertFails(getDoc(doc(ownerDb(), 'accountDeletions', 'del-1')));
    await assertFails(setDoc(doc(ownerDb(), 'accountDeletions', 'del-1'), { uid: UID }));
  });
});

describe('accountActive — isolation between uids', () => {
  it("another authenticated user's lock never affects the owner's own access", async () => {
    await seedLock(OTHER_UID);
    await assertSucceeds(getDoc(doc(ownerDb(), 'users', UID)));
  });

  it("the owner's lock does not grant them access to another uid's data, and does not affect that other uid's own access", async () => {
    await seedLock(UID);
    await assertFails(getDoc(doc(ownerDb(), 'users', OTHER_UID)));
    await assertSucceeds(getDoc(doc(otherDb(), 'users', OTHER_UID))); // OTHER_UID is not locked
  });
});
