/**
 * Firestore Rules — behavioral tests for the Photo Vault data model
 * (docs/20_backend_functions_photo_vault.md):
 *
 *   - users/{userId}/progressPhotos/{photoId} — photo metadata, owner-only,
 *     immutable after creation, with storagePath pinned to the owner's uid.
 *   - users/{userId}/privateSecurity/{documentId} — backend-only; the client
 *     must never read or write the wrapped vault key.
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
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const OTHER_UID = 'mallory';
const PHOTO_ID = 'photo-001';

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

/**
 * A valid photo metadata payload. `createdAt` must be serverTimestamp() —
 * the rules require `== request.time` so a client cannot forge it.
 */
function validPhoto(overrides: Record<string, unknown> = {}, uid = UID, photoId = PHOTO_ID) {
  return {
    storagePath: `users/${uid}/progressPhotos/${photoId}.enc`,
    createdAt: serverTimestamp(),
    takenAt: Timestamp.fromDate(new Date('2026-08-01T10:00:00Z')),
    originalMimeType: 'image/jpeg',
    encryptedSize: 2_400_000,
    encryption: {
      version: 1,
      algorithm: 'AES-256-GCM',
      iv: 'YWJjZGVmZ2hpamts', // base64 of 12 random bytes (96-bit GCM nonce)
      vaultKeyVersion: 1,
    },
    ...overrides,
  };
}

function validPhotoWithThumbnail(
  overrides: Record<string, unknown> = {},
  uid = UID,
  photoId = PHOTO_ID,
) {
  return validPhoto(
    {
      thumbnailStoragePath: `users/${uid}/progressPhotos/${photoId}.thumb.enc`,
      thumbnailEncryptedSize: 120_000,
      thumbnailEncryption: {
        version: 1,
        algorithm: 'AES-256-GCM',
        iv: 'bW5vcHFyc3R1dnd4',
        vaultKeyVersion: 1,
      },
      ...overrides,
    },
    uid,
    photoId,
  );
}

/** Seeds an existing photo document bypassing rules (baseline for read/update/delete). */
async function seedPhoto(uid = UID, photoId = PHOTO_ID) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid, 'progressPhotos', photoId), {
      ...validPhoto({}, uid, photoId),
      createdAt: Timestamp.now(),
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

// ── progressPhotos: owner happy path ───────────────────────────────────────

describe('progressPhotos — owner', () => {
  it('allows the owner to create their own photo metadata', async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID), validPhoto()),
    );
  });

  it('allows the closed Phase-13 thumbnail schema', async () => {
    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID),
        validPhotoWithThumbnail(),
      ),
    );
  });

  it('allows the owner to read their own photo metadata', async () => {
    await seedPhoto();
    await assertSucceeds(getDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID)));
  });

  it('allows the owner to list their own photos', async () => {
    await seedPhoto();
    await assertSucceeds(getDocs(collection(ownerDb(), 'users', UID, 'progressPhotos')));
  });

  it('allows the owner to delete their own photo metadata', async () => {
    await seedPhoto();
    await assertSucceeds(deleteDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID)));
  });

  it('accepts every allowed originalMimeType', async () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']) {
      const id = `photo-${mime.replace('/', '-')}`;
      await assertSucceeds(
        setDoc(
          doc(ownerDb(), 'users', UID, 'progressPhotos', id),
          validPhoto({ originalMimeType: mime }, UID, id),
        ),
      );
    }
  });
});

// ── progressPhotos: immutability ───────────────────────────────────────────

describe('progressPhotos — immutability', () => {
  beforeEach(() => seedPhoto());

  it('rejects the owner updating their own photo metadata', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID), {
        takenAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')),
      }),
    );
  });

  it('rejects the owner overwriting the document with setDoc', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID), validPhoto()),
    );
  });

  it('rejects rewriting storagePath to point somewhere else', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID), {
        storagePath: `users/${OTHER_UID}/progressPhotos/${PHOTO_ID}.enc`,
      }),
    );
  });
});

// ── progressPhotos: cross-user isolation ───────────────────────────────────

describe('progressPhotos — cross-user isolation', () => {
  it("blocks another user from reading someone else's photo metadata", async () => {
    await seedPhoto();
    await assertFails(getDoc(doc(otherDb(), 'users', UID, 'progressPhotos', PHOTO_ID)));
  });

  it("blocks another user from listing someone else's photos", async () => {
    await seedPhoto();
    await assertFails(getDocs(collection(otherDb(), 'users', UID, 'progressPhotos')));
  });

  it("blocks another user from creating metadata under someone else's uid", async () => {
    await assertFails(
      setDoc(doc(otherDb(), 'users', UID, 'progressPhotos', PHOTO_ID), validPhoto()),
    );
  });

  it("blocks another user from deleting someone else's photo metadata", async () => {
    await seedPhoto();
    await assertFails(deleteDoc(doc(otherDb(), 'users', UID, 'progressPhotos', PHOTO_ID)));
  });
});

// ── progressPhotos: unauthenticated ────────────────────────────────────────

describe('progressPhotos — unauthenticated', () => {
  it('blocks unauthenticated reads', async () => {
    await seedPhoto();
    await assertFails(getDoc(doc(anonDb(), 'users', UID, 'progressPhotos', PHOTO_ID)));
  });

  it('blocks unauthenticated creates', async () => {
    await assertFails(
      setDoc(doc(anonDb(), 'users', UID, 'progressPhotos', PHOTO_ID), validPhoto()),
    );
  });

  it('blocks unauthenticated deletes', async () => {
    await seedPhoto();
    await assertFails(deleteDoc(doc(anonDb(), 'users', UID, 'progressPhotos', PHOTO_ID)));
  });
});

// ── progressPhotos: storagePath binding ────────────────────────────────────

describe('progressPhotos — storagePath must be pinned to owner and photoId', () => {
  it("rejects a storagePath under another user's namespace", async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID),
        validPhoto({ storagePath: `users/${OTHER_UID}/progressPhotos/${PHOTO_ID}.enc` }),
      ),
    );
  });

  it('rejects a storagePath whose photoId differs from the document id', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID),
        validPhoto({ storagePath: `users/${UID}/progressPhotos/some-other-id.enc` }),
      ),
    );
  });

  it('rejects a storagePath pointing at the avatar path', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID),
        validPhoto({ storagePath: `users/${UID}/profile/avatar` }),
      ),
    );
  });

  it('rejects a storagePath without the .enc suffix', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID),
        validPhoto({ storagePath: `users/${UID}/progressPhotos/${PHOTO_ID}` }),
      ),
    );
  });

  it('rejects a traversal-style storagePath', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID),
        validPhoto({
          storagePath: `users/${UID}/progressPhotos/../../${OTHER_UID}/progressPhotos/${PHOTO_ID}.enc`,
        }),
      ),
    );
  });

  it('rejects a non-string storagePath', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID),
        validPhoto({ storagePath: 42 }),
      ),
    );
  });
});

// ── progressPhotos: schema enforcement ─────────────────────────────────────

describe('progressPhotos — schema', () => {
  function rejects(name: string, payload: Record<string, unknown>) {
    it(name, async () => {
      await assertFails(
        setDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID), payload),
      );
    });
  }

  rejects('rejects an extra top-level field', validPhoto({ downloadURL: 'https://example.com' }));
  rejects('rejects a persisted signed URL field', validPhoto({ signedUrl: 'https://example.com' }));
  rejects('rejects a thumbnail blob field', validPhoto({ thumbnailBase64: 'AAAA' }));
  rejects(
    'rejects partial thumbnail metadata',
    validPhoto({
      thumbnailStoragePath: `users/${UID}/progressPhotos/${PHOTO_ID}.thumb.enc`,
    }),
  );
  rejects(
    'rejects a thumbnail path not pinned to the same uid/photoId',
    validPhotoWithThumbnail({
      thumbnailStoragePath: `users/${OTHER_UID}/progressPhotos/${PHOTO_ID}.thumb.enc`,
    }),
  );
  rejects(
    'rejects a thumbnail above 512 KiB',
    validPhotoWithThumbnail({ thumbnailEncryptedSize: 512 * 1024 + 1 }),
  );
  rejects(
    'rejects AES-GCM nonce reuse between full and thumbnail',
    validPhotoWithThumbnail({
      thumbnailEncryption: {
        version: 1,
        algorithm: 'AES-256-GCM',
        iv: 'YWJjZGVmZ2hpamts',
        vaultKeyVersion: 1,
      },
    }),
  );

  rejects('rejects a missing storagePath', (() => {
    const { storagePath: _omitted, ...rest } = validPhoto();
    return rest;
  })());
  rejects('rejects a missing takenAt', (() => {
    const { takenAt: _omitted, ...rest } = validPhoto();
    return rest;
  })());
  rejects('rejects a missing encryption map', (() => {
    const { encryption: _omitted, ...rest } = validPhoto();
    return rest;
  })());
  rejects('rejects a missing encryptedSize', (() => {
    const { encryptedSize: _omitted, ...rest } = validPhoto();
    return rest;
  })());

  rejects('rejects a client-forged createdAt', validPhoto({ createdAt: Timestamp.now() }));
  rejects('rejects a takenAt in the future', validPhoto({
    takenAt: Timestamp.fromDate(new Date(Date.now() + 86_400_000)),
  }));
  rejects('rejects a non-timestamp takenAt', validPhoto({ takenAt: '2026-08-01' }));

  rejects('rejects an unlisted originalMimeType', validPhoto({ originalMimeType: 'image/gif' }));
  rejects('rejects application/octet-stream as originalMimeType', validPhoto({
    originalMimeType: 'application/octet-stream',
  }));

  rejects('rejects a non-int encryptedSize', validPhoto({ encryptedSize: 2_400_000.5 }));
  rejects('rejects a zero encryptedSize', validPhoto({ encryptedSize: 0 }));
  rejects('rejects a negative encryptedSize', validPhoto({ encryptedSize: -1 }));
  rejects('rejects an encryptedSize above the 10 MB ceiling', validPhoto({
    encryptedSize: 10 * 1024 * 1024 + 1,
  }));

  it('accepts an encryptedSize exactly at the 10 MB ceiling', async () => {
    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID),
        validPhoto({ encryptedSize: 10 * 1024 * 1024 }),
      ),
    );
  });
});

// ── progressPhotos: encryption metadata ────────────────────────────────────

describe('progressPhotos — encryption metadata', () => {
  function rejectsEncryption(name: string, encryption: unknown) {
    it(name, async () => {
      await assertFails(
        setDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID), validPhoto({ encryption })),
      );
    });
  }

  rejectsEncryption('rejects an unsupported algorithm', {
    version: 1,
    algorithm: 'AES-128-CBC',
    iv: 'YWJjZGVmZ2hpamts',
    vaultKeyVersion: 1,
  });
  rejectsEncryption('rejects a plaintext/none algorithm', {
    version: 1,
    algorithm: 'none',
    iv: 'YWJjZGVmZ2hpamts',
    vaultKeyVersion: 1,
  });
  rejectsEncryption('rejects a zero encryption version', {
    version: 0,
    algorithm: 'AES-256-GCM',
    iv: 'YWJjZGVmZ2hpamts',
    vaultKeyVersion: 1,
  });
  rejectsEncryption('rejects a negative vaultKeyVersion', {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: 'YWJjZGVmZ2hpamts',
    vaultKeyVersion: -1,
  });
  rejectsEncryption('rejects a non-int version', {
    version: 1.5,
    algorithm: 'AES-256-GCM',
    iv: 'YWJjZGVmZ2hpamts',
    vaultKeyVersion: 1,
  });
  rejectsEncryption('rejects an empty iv', {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: '',
    vaultKeyVersion: 1,
  });
  rejectsEncryption('rejects an oversized iv', {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: 'A'.repeat(64),
    vaultKeyVersion: 1,
  });
  rejectsEncryption('rejects an extra field inside encryption', {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: 'YWJjZGVmZ2hpamts',
    vaultKeyVersion: 1,
    vaultKey: 'obviously-not-allowed',
  });
  rejectsEncryption('rejects a missing iv', {
    version: 1,
    algorithm: 'AES-256-GCM',
    vaultKeyVersion: 1,
  });
  rejectsEncryption('rejects encryption as a non-map', 'AES-256-GCM');
});

// ── privateSecurity: backend-only ──────────────────────────────────────────

describe('privateSecurity/photoVault — backend-only', () => {
  const vaultDoc = {
    wrappedVaultKey: 'base64-ciphertext',
    encryptionVersion: 1,
    vaultKeyVersion: 1,
    kmsKeyVersion: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',
    algorithm: 'AES-256-GCM',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  async function seedVault() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'privateSecurity', 'photoVault'), {
        ...vaultDoc,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });
  }

  it('blocks the owner from reading their own wrapped vault key', async () => {
    await seedVault();
    await assertFails(getDoc(doc(ownerDb(), 'users', UID, 'privateSecurity', 'photoVault')));
  });

  it('blocks the owner from creating the vault document', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), 'users', UID, 'privateSecurity', 'photoVault'), vaultDoc),
    );
  });

  it('blocks the owner from updating the vault document', async () => {
    await seedVault();
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID, 'privateSecurity', 'photoVault'), {
        vaultKeyVersion: 2,
      }),
    );
  });

  it('blocks the owner from deleting the vault document', async () => {
    await seedVault();
    await assertFails(deleteDoc(doc(ownerDb(), 'users', UID, 'privateSecurity', 'photoVault')));
  });

  it('blocks the owner from listing the privateSecurity collection', async () => {
    await seedVault();
    await assertFails(getDocs(collection(ownerDb(), 'users', UID, 'privateSecurity')));
  });

  it('blocks another user from reading the vault document', async () => {
    await seedVault();
    await assertFails(getDoc(doc(otherDb(), 'users', UID, 'privateSecurity', 'photoVault')));
  });

  it('blocks unauthenticated access to the vault document', async () => {
    await seedVault();
    await assertFails(getDoc(doc(anonDb(), 'users', UID, 'privateSecurity', 'photoVault')));
  });

  it('blocks the client from smuggling the vault under a different document id', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), 'users', UID, 'privateSecurity', 'anythingElse'), vaultDoc),
    );
  });

  it('remains readable by the Admin SDK (rules bypass) — the backend still owns it', async () => {
    await seedVault();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'users', UID, 'privateSecurity', 'photoVault'));
      expect(snap.exists()).toBe(true);
      expect(snap.data()?.wrappedVaultKey).toBe('base64-ciphertext');
    });
  });
});

// ── orphan cleanup markers: backend-only ─────────────────────────────────

describe('_photoVaultCleanupCandidates — backend-only', () => {
  const marker = {
    kind: 'storage-without-firestore',
    storagePath: `users/${UID}/progressPhotos/${PHOTO_ID}.enc`,
    fingerprint: '7',
    firstSeenAt: serverTimestamp(),
  };

  it('blocks authenticated clients from reading or creating cleanup markers', async () => {
    const ref = doc(ownerDb(), '_photoVaultCleanupCandidates', 'candidate');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, marker));
  });

  it('blocks unauthenticated clients and remains writable only through Admin SDK', async () => {
    await assertFails(
      getDoc(doc(anonDb(), '_photoVaultCleanupCandidates', 'candidate')),
    );
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await assertSucceeds(
        setDoc(doc(ctx.firestore(), '_photoVaultCleanupCandidates', 'candidate'), {
          ...marker,
          firstSeenAt: Timestamp.now(),
        }),
      );
    });
  });
});
