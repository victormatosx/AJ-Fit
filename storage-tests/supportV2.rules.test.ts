import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const ADMIN_UID = 'support-admin';
const UPLOAD_ID = 'upload_12345678';
const PATH = `users/${UID}/support-v2/staged/${UPLOAD_ID}`;
let storageEnv: RulesTestEnvironment;
let firestoreEnv: RulesTestEnvironment;

function storage(uid: string) {
  return storageEnv.authenticatedContext(uid, {
    email_verified: true,
    firebase: { identities: { email: [`${uid}@example.com`] }, sign_in_provider: 'password' },
  }).storage();
}

async function seed() {
  await firestoreEnv.withSecurityRulesDisabled(async (ctx) => {
    const firestore = ctx.firestore();
    for (const [uid, role] of [[UID, 'user'], [ADMIN_UID, 'admin']]) {
      await setDoc(doc(firestore, 'users', uid), { metadata: { role } });
    }
    await setDoc(doc(firestore, 'supportUploadSessions', UPLOAD_ID), {
      ownerUid: UID, mimeType: 'image/jpeg', storagePath: PATH, status: 'STAGED',
      createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
  });
}

async function seedObject() {
  await storageEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref(PATH).put(new Uint8Array(128), { contentType: 'image/jpeg' });
  });
}

function put(uid: string, metadata = { ownerId: UID, uploadId: UPLOAD_ID }, contentType = 'image/jpeg') {
  return Promise.resolve(storage(uid).ref(PATH).put(new Uint8Array(128), { contentType, customMetadata: metadata }));
}

beforeAll(async () => {
  storageEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, storage: { rules: readFileSync(resolve(__dirname, '../storage.rules'), 'utf8') } });
  firestoreEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') } });
});
afterAll(async () => { await storageEnv.cleanup(); await firestoreEnv.cleanup(); });
beforeEach(async () => { await storageEnv.clearStorage(); await firestoreEnv.clearFirestore(); await seed(); });

describe('support V2 staged attachments', () => {
  it('accepts the owner once with the exact server capability and blocks overwrite', async () => {
    await assertSucceeds(put(UID));
    await assertFails(put(UID));
  });

  it('rejects cross-user uploads, forged metadata and unsupported MIME', async () => {
    await assertFails(put('mallory'));
    await assertFails(put(UID, { ownerId: 'mallory', uploadId: UPLOAD_ID }));
    await assertFails(put(UID, { ownerId: UID, uploadId: UPLOAD_ID }, 'application/pdf'));
  });

  it('denies direct owner reads and client delete (downloads require a short-lived backend grant)', async () => {
    await seedObject();
    await assertFails(storage(UID).ref(PATH).getDownloadURL());
    await assertFails(storage('mallory').ref(PATH).getDownloadURL());
    await assertFails(storage(UID).ref(PATH).delete());
  });

  it('denies direct admin reads so the admin must use its authorized callable', async () => {
    await seedObject();
    await assertFails(storage(ADMIN_UID).ref(PATH).getDownloadURL());
  });

  it('rejects an expired capability and an account deletion lock', async () => {
    await firestoreEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'supportUploadSessions', UPLOAD_ID), {
        ownerUid: UID, mimeType: 'image/jpeg', storagePath: PATH, status: 'STAGED',
        createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() - 1),
      });
    });
    await assertFails(put(UID));
    await firestoreEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'accountDeletionLocks', UID), { createdAt: Timestamp.now() });
    });
    await assertFails(storage(UID).ref(PATH).getDownloadURL());
  });
});
