/**
 * Storage Rules — behavioral tests for `accountActive(userId)` (Fase 5,
 * docs/25_exclusao_de_conta_arquitetura.md — "Bloqueio imediato da conta").
 *
 * Mirrors `firestore-tests/accountDeletionLock.rules.test.ts`: a still
 * cryptographically-valid session must not be able to read/upload/delete
 * private Storage objects once `accountDeletionLocks/{uid}` exists.
 *
 * Executed against the Storage + Firestore emulators (storage.rules'
 * `accountActive`/`hasServerPremium` read Firestore via `firestore.exists`/
 * `firestore.get` — same two-environment seeding pattern as
 * `progressPhotos.rules.test.ts`). See the `test:rules` npm script.
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
import { doc, setDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const PHOTO_ID = 'photo-001';
const AVATAR_PATH = `users/${UID}/profile/avatar`;
const PHOTO_PATH = `users/${UID}/progressPhotos/${PHOTO_ID}.enc`;
const OCTET_STREAM = 'application/octet-stream';

let testEnv: RulesTestEnvironment;
let testEnvFirestore: RulesTestEnvironment;

function ownerStorage() {
  return testEnv.authenticatedContext(UID, { email: 'alice@example.com' }).storage();
}

type Storage = ReturnType<typeof ownerStorage>;
type UploadMetadata = Parameters<ReturnType<Storage['ref']>['put']>[1];

function put(storage: Storage, path: string, data: Uint8Array, metadata?: UploadMetadata) {
  return Promise.resolve(storage.ref(path).put(data, metadata));
}

function ciphertext(bytes = 1024): Uint8Array {
  return new Uint8Array(bytes);
}

async function seedPremium(uid: string) {
  await testEnvFirestore.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { subscription: { entitlementActive: true } }, { merge: true });
  });
}

async function seedLock(uid = UID, status: string = 'REQUESTED') {
  await testEnvFirestore.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'accountDeletionLocks', uid), {
      uid,
      activeDeletionId: 'del-1',
      status,
      revision: 0,
    });
  });
}

async function seedAvatar() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref(AVATAR_PATH).put(ciphertext(), { contentType: 'image/jpeg' });
  });
}

async function seedPhoto() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx
      .storage()
      .ref(PHOTO_PATH)
      .put(ciphertext(), { contentType: OCTET_STREAM, customMetadata: { ownerId: UID, photoId: PHOTO_ID } });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: { rules: readFileSync(resolve(__dirname, '../storage.rules'), 'utf8') },
  });
  testEnvFirestore = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
  await testEnvFirestore.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
  await testEnvFirestore.clearFirestore();
  await seedPremium(UID);
});

describe('accountActive (Storage) — active account — unchanged baseline', () => {
  it('allows reading an existing avatar', async () => {
    await seedAvatar();
    await assertSucceeds(ownerStorage().ref(AVATAR_PATH).getDownloadURL());
  });

  it('allows uploading a new avatar', async () => {
    await assertSucceeds(put(ownerStorage(), AVATAR_PATH, ciphertext(), { contentType: 'image/jpeg' }));
  });

  it('allows reading an existing progress photo', async () => {
    await seedPhoto();
    await assertSucceeds(ownerStorage().ref(PHOTO_PATH).getDownloadURL());
  });
});

describe.each(['REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED_TERMINAL'])(
  'accountActive (Storage) — locked account (status=%s) — every private path denied',
  (status) => {
    beforeEach(async () => {
      await seedAvatar();
      await seedPhoto();
      await seedLock(UID, status);
    });

    it('denies reading the avatar', async () => {
      await assertFails(ownerStorage().ref(AVATAR_PATH).getDownloadURL());
    });

    it('denies uploading a new avatar', async () => {
      await assertFails(put(ownerStorage(), AVATAR_PATH, ciphertext(), { contentType: 'image/jpeg' }));
    });

    it('denies deleting the avatar', async () => {
      await assertFails(Promise.resolve(ownerStorage().ref(AVATAR_PATH).delete()));
    });

    it('denies reading an existing progress photo', async () => {
      await assertFails(ownerStorage().ref(PHOTO_PATH).getDownloadURL());
    });

    it('denies uploading a new progress photo', async () => {
      await assertFails(
        put(ownerStorage(), `users/${UID}/progressPhotos/photo-002.enc`, ciphertext(), {
          contentType: OCTET_STREAM,
          customMetadata: { ownerId: UID, photoId: 'photo-002' },
        }),
      );
    });

    it('denies deleting an existing progress photo', async () => {
      await assertFails(Promise.resolve(ownerStorage().ref(PHOTO_PATH).delete()));
    });
  },
);

describe('accountActive (Storage) — lock lifecycle', () => {
  it('access is denied immediately after the lock is created, and restored if the lock is removed (sanity check of the mechanism itself)', async () => {
    await seedAvatar();
    await assertSucceeds(ownerStorage().ref(AVATAR_PATH).getDownloadURL());

    await seedLock(UID);
    await assertFails(ownerStorage().ref(AVATAR_PATH).getDownloadURL());

    await testEnvFirestore.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'accountDeletionLocks', UID));
    });
    await assertSucceeds(ownerStorage().ref(AVATAR_PATH).getDownloadURL());
  });
});
