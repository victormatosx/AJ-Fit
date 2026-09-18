import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where,
} from 'firebase/firestore';

/**
 * Regression lock for Support V2 (`supportCases`, `supportUploadSessions`,
 * `supportRateLimits`).
 *
 * These three blocks were live in the deployed ruleset but had never been
 * committed to `firestore.rules` (`git log -S supportCases -- firestore.rules`
 * is empty). A merge then produced a versioned rules file whose only support
 * coverage was the legacy `supportTickets` lineage — so deploying it would
 * have default-denied every Support V2 read and silently broken a shipped
 * feature. Nothing in the suite would have caught that, because nothing
 * tested these paths at all.
 *
 * Every expectation below is the behavior of the ruleset that was ACTIVE in
 * production (release `cloud.firestore`, ruleset 48c07514, 2026-09-17T22:30Z),
 * so this file doubles as the compatibility contract between the two lineages:
 * all mutations are Admin-SDK-only callables (`createSupportCase`,
 * `sendSupportChatMessage`, `markSupportMessageRead`, and the `admin*`
 * counterparts in functions/src/index.ts); clients get reads, and only of
 * their own case.
 */

const PROJECT_ID = 'ajfit-rules-test';
const OWNER_UID = 'alice';
const OTHER_UID = 'mallory';
const ADMIN_UID = 'support-admin';
const CASE_ID = 'case_alice_1';
const OTHER_CASE_ID = 'case_mallory_1';
const MESSAGE_ID = 'msg_1';

let testEnv: RulesTestEnvironment;

/** Federated (Apple/Google) identity: no `email` provider entry, so `hasPasswordIdentity()` is false. */
function dbFor(uid: string) {
  return testEnv.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
}

/** Password identity with an unverified email — `hasVerifiedEmailForPrivateAccess()` must reject it. */
function unverifiedPasswordDbFor(uid: string) {
  return testEnv.authenticatedContext(uid, {
    email: `${uid}@example.com`,
    email_verified: false,
    firebase: { sign_in_provider: 'password', identities: { email: [`${uid}@example.com`] } },
  }).firestore();
}

function userDocument(uid: string, role: 'user' | 'admin' = 'user') {
  return {
    profile: { name: uid, email: `${uid}@example.com` },
    preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
    subscription: {},
    metadata: { role, createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
  };
}

function caseDocument(ownerUid: string) {
  return {
    caseId: CASE_ID, ownerUid, status: 'OPEN', subject: 'Falha ao iniciar o treino',
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  };
}

function messageDocument(ownerUid: string) {
  return {
    senderType: 'USER', senderId: ownerUid, message: 'A tela fecha ao iniciar o treino.',
    attachments: [], createdAt: Timestamp.now(), readAt: null,
  };
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
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, 'users', OWNER_UID), userDocument(OWNER_UID));
    await setDoc(doc(database, 'users', OTHER_UID), userDocument(OTHER_UID));
    await setDoc(doc(database, 'users', ADMIN_UID), userDocument(ADMIN_UID, 'admin'));
    // Admin SDK seeding — the only way these documents are ever produced.
    await setDoc(doc(database, 'supportCases', CASE_ID), caseDocument(OWNER_UID));
    await setDoc(doc(database, 'supportCases', CASE_ID, 'messages', MESSAGE_ID), messageDocument(OWNER_UID));
    await setDoc(doc(database, 'supportCases', OTHER_CASE_ID), { ...caseDocument(OTHER_UID), caseId: OTHER_CASE_ID });
    await setDoc(doc(database, 'supportUploadSessions', 'upload_1'), {
      uploadId: 'upload_1', ownerUid: OWNER_UID, caseId: CASE_ID, bytesRemaining: 1, createdAt: Timestamp.now(),
    });
    await setDoc(doc(database, 'supportRateLimits', OWNER_UID), {
      ownerUid: OWNER_UID, windowStartedAt: Timestamp.now(), count: 1,
    });
  });
});

describe('supportCases — owner reads', () => {
  it('lets the owner get their own case', async () => {
    const snapshot = await assertSucceeds(getDoc(doc(dbFor(OWNER_UID), 'supportCases', CASE_ID)));
    expect(snapshot.data()?.ownerUid).toBe(OWNER_UID);
  });

  it('lets the owner list only cases constrained to their own ownerUid', async () => {
    const database = dbFor(OWNER_UID);
    const owned = await assertSucceeds(getDocs(query(
      collection(database, 'supportCases'), where('ownerUid', '==', OWNER_UID),
    )));
    expect(owned.docs.map((entry) => entry.id)).toEqual([CASE_ID]);
    // An unconstrained list would expose other users' cases: `resource.data`
    // is evaluated per candidate document, so the query must be narrowed.
    await assertFails(getDocs(collection(database, 'supportCases')));
    await assertFails(getDocs(query(
      collection(database, 'supportCases'), where('ownerUid', '==', OTHER_UID),
    )));
  });

  it('denies another authenticated user reading a case they do not own', async () => {
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'supportCases', CASE_ID)));
  });

  it('denies an unauthenticated read', async () => {
    const anonymous = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonymous, 'supportCases', CASE_ID)));
  });

  it('denies a password identity whose email is not verified', async () => {
    await assertFails(getDoc(doc(unverifiedPasswordDbFor(OWNER_UID), 'supportCases', CASE_ID)));
  });

  it('denies the owner once an account deletion lock exists (accountActive)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'accountDeletionLocks', OWNER_UID), {
        uid: OWNER_UID, createdAt: Timestamp.now(),
      });
    });
    await assertFails(getDoc(doc(dbFor(OWNER_UID), 'supportCases', CASE_ID)));
  });
});

describe('supportCases — client mutations are always denied (Admin SDK callables only)', () => {
  it('denies create, update and delete to the owner', async () => {
    const database = dbFor(OWNER_UID);
    await assertFails(setDoc(doc(database, 'supportCases', 'case_forged'), caseDocument(OWNER_UID)));
    await assertFails(updateDoc(doc(database, 'supportCases', CASE_ID), { status: 'CLOSED' }));
    await assertFails(deleteDoc(doc(database, 'supportCases', CASE_ID)));
  });

  it('denies create, update and delete to an admin too — privilege does not unlock direct writes', async () => {
    const database = dbFor(ADMIN_UID);
    await assertFails(setDoc(doc(database, 'supportCases', 'case_forged_admin'), caseDocument(OWNER_UID)));
    await assertFails(updateDoc(doc(database, 'supportCases', CASE_ID), { status: 'CLOSED' }));
    await assertFails(deleteDoc(doc(database, 'supportCases', CASE_ID)));
  });
});

describe('supportCases/{caseId}/messages', () => {
  it('lets the owner read the thread of their own case', async () => {
    const database = dbFor(OWNER_UID);
    await assertSucceeds(getDoc(doc(database, 'supportCases', CASE_ID, 'messages', MESSAGE_ID)));
    await assertSucceeds(getDocs(collection(database, 'supportCases', CASE_ID, 'messages')));
  });

  it('denies another user reading that thread', async () => {
    const database = dbFor(OTHER_UID);
    await assertFails(getDoc(doc(database, 'supportCases', CASE_ID, 'messages', MESSAGE_ID)));
    await assertFails(getDocs(collection(database, 'supportCases', CASE_ID, 'messages')));
  });

  it('denies the owner writing a message directly', async () => {
    const database = dbFor(OWNER_UID);
    await assertFails(setDoc(
      doc(database, 'supportCases', CASE_ID, 'messages', 'msg_forged'), messageDocument(OWNER_UID),
    ));
    await assertFails(updateDoc(
      doc(database, 'supportCases', CASE_ID, 'messages', MESSAGE_ID), { readAt: Timestamp.now() },
    ));
    await assertFails(deleteDoc(doc(database, 'supportCases', CASE_ID, 'messages', MESSAGE_ID)));
  });
});

describe('supportCases — admin access', () => {
  it('lets an admin read any case and its messages, and list without an owner constraint', async () => {
    const database = dbFor(ADMIN_UID);
    await assertSucceeds(getDoc(doc(database, 'supportCases', CASE_ID)));
    await assertSucceeds(getDoc(doc(database, 'supportCases', OTHER_CASE_ID)));
    await assertSucceeds(getDocs(collection(database, 'supportCases')));
    await assertSucceeds(getDocs(collection(database, 'supportCases', CASE_ID, 'messages')));
  });

  it('denies a user whose metadata.role is not admin from reading another user\'s case', async () => {
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'supportCases', CASE_ID)));
  });

  it('denies an admin under an account deletion lock', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'accountDeletionLocks', ADMIN_UID), {
        uid: ADMIN_UID, createdAt: Timestamp.now(),
      });
    });
    await assertFails(getDoc(doc(dbFor(ADMIN_UID), 'supportCases', OTHER_CASE_ID)));
  });
});

describe('supportUploadSessions / supportRateLimits — backend control plane', () => {
  it('denies every client read and write on supportUploadSessions, owner and admin alike', async () => {
    for (const uid of [OWNER_UID, ADMIN_UID]) {
      const database = dbFor(uid);
      await assertFails(getDoc(doc(database, 'supportUploadSessions', 'upload_1')));
      await assertFails(getDocs(collection(database, 'supportUploadSessions')));
      await assertFails(setDoc(doc(database, 'supportUploadSessions', 'upload_forged'), { ownerUid: uid }));
      await assertFails(updateDoc(doc(database, 'supportUploadSessions', 'upload_1'), { bytesRemaining: 999 }));
      await assertFails(deleteDoc(doc(database, 'supportUploadSessions', 'upload_1')));
    }
  });

  it('denies every client read and write on supportRateLimits, owner and admin alike', async () => {
    for (const uid of [OWNER_UID, ADMIN_UID]) {
      const database = dbFor(uid);
      await assertFails(getDoc(doc(database, 'supportRateLimits', OWNER_UID)));
      await assertFails(getDocs(collection(database, 'supportRateLimits')));
      await assertFails(setDoc(doc(database, 'supportRateLimits', uid), { count: 0 }));
      await assertFails(updateDoc(doc(database, 'supportRateLimits', OWNER_UID), { count: 0 }));
      await assertFails(deleteDoc(doc(database, 'supportRateLimits', OWNER_UID)));
    }
  });
});
