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

// ── progressPhotos: posed schema (phase 14) ────────────────────────────────
//
// The third accepted shape adds assetId/dateKey/pose. Its document is named
// `{dateKey}_{pose}` so Firestore itself enforces at most one photo per pose
// per day — `create` only fires on a non-existent document and `update` is
// denied outright. The ciphertext keeps an opaque UUID name so the Storage
// object never reveals the day or the pose.

const ASSET_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_ASSET_ID = '550e8400-e29b-41d4-a716-446655440001';
const DATE_KEY = '2026-08-01';
const POSED_ID = `${DATE_KEY}_front`;

function validPosedPhoto(
  overrides: Record<string, unknown> = {},
  uid = UID,
  assetId = ASSET_ID,
) {
  return {
    storagePath: `users/${uid}/progressPhotos/${assetId}.enc`,
    thumbnailStoragePath: `users/${uid}/progressPhotos/${assetId}.thumb.enc`,
    assetId,
    dateKey: DATE_KEY,
    pose: 'front',
    createdAt: serverTimestamp(),
    takenAt: Timestamp.fromDate(new Date('2026-08-01T10:00:00Z')),
    originalMimeType: 'image/jpeg',
    encryptedSize: 2_400_000,
    thumbnailEncryptedSize: 120_000,
    encryption: {
      version: 1,
      algorithm: 'AES-256-GCM',
      iv: 'YWJjZGVmZ2hpamts',
      vaultKeyVersion: 1,
    },
    thumbnailEncryption: {
      version: 1,
      algorithm: 'AES-256-GCM',
      iv: 'bW5vcHFyc3R1dnd4',
      vaultKeyVersion: 1,
    },
    ...overrides,
  };
}

function createPosed(payload: Record<string, unknown>, documentId = POSED_ID, db = ownerDb()) {
  return setDoc(doc(db, 'users', UID, 'progressPhotos', documentId), payload);
}

describe('progressPhotos — posed schema accepted', () => {
  for (const pose of ['front', 'side', 'back']) {
    it(`accepts the ${pose} pose with a matching document id`, async () => {
      await assertSucceeds(
        createPosed(validPosedPhoto({ pose }), `${DATE_KEY}_${pose}`),
      );
    });
  }

  it('accepts a photo whose day is far in the past', async () => {
    // `takenAt` may come from EXIF, so a library photo legitimately belongs to
    // any past day. There is deliberately no lower bound on dateKey.
    await assertSucceeds(
      createPosed(
        validPosedPhoto({
          dateKey: '2020-01-15',
          takenAt: Timestamp.fromDate(new Date('2020-01-15T10:00:00Z')),
        }),
        '2020-01-15_front',
      ),
    );
  });

  it('stores the asset under an opaque uuid, not under the day or pose', async () => {
    await assertSucceeds(createPosed(validPosedPhoto()));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snapshot = await getDoc(
        doc(ctx.firestore(), 'users', UID, 'progressPhotos', POSED_ID),
      );
      expect(snapshot.data()?.storagePath).toBe(
        `users/${UID}/progressPhotos/${ASSET_ID}.enc`,
      );
      expect(snapshot.data()?.storagePath).not.toContain(DATE_KEY);
      expect(snapshot.data()?.storagePath).not.toContain('front');
    });
  });
});

describe('progressPhotos — posed uniqueness and document id', () => {
  it('refuses a second photo for the same day and pose', async () => {
    await assertSucceeds(createPosed(validPosedPhoto()));
    // The id is the uniqueness key, so the second write is an update, and
    // updates are denied. Firestore enforces this, not the client.
    await assertFails(createPosed(validPosedPhoto({ assetId: OTHER_ASSET_ID })));
  });

  it('allows a different pose on the same day', async () => {
    await assertSucceeds(createPosed(validPosedPhoto()));
    await assertSucceeds(
      createPosed(
        validPosedPhoto({ pose: 'side', assetId: OTHER_ASSET_ID }, UID, OTHER_ASSET_ID),
        `${DATE_KEY}_side`,
      ),
    );
  });

  it('rejects a document id that does not encode dateKey and pose', async () => {
    await assertFails(createPosed(validPosedPhoto(), 'arbitrary-id'));
  });

  it('rejects the right day with the wrong pose in the id', async () => {
    await assertFails(createPosed(validPosedPhoto({ pose: 'front' }), `${DATE_KEY}_side`));
  });

  it('rejects the right pose with the wrong day in the id', async () => {
    await assertFails(createPosed(validPosedPhoto(), '2026-08-02_front'));
  });
});

describe('progressPhotos — posed pose validation', () => {
  const rejects = (name: string, pose: unknown) =>
    it(name, async () => {
      await assertFails(
        createPosed(validPosedPhoto({ pose }), `${DATE_KEY}_${String(pose)}`),
      );
    });

  rejects('rejects an uppercase pose', 'Front');
  rejects('rejects a translated pose', 'frente');
  rejects('rejects an unlisted pose', 'profile');
  // "unknown" must never become a fourth persisted value: the ABSENCE of the
  // field is what identifies a pre-pose photo.
  rejects('rejects unknown as a pose', 'unknown');
  rejects('rejects an empty pose', '');
  rejects('rejects a null pose', null);
  rejects('rejects a non-string pose', 3);
});

describe('progressPhotos — posed dateKey validation', () => {
  const rejects = (name: string, dateKey: unknown) =>
    it(name, async () => {
      await assertFails(
        createPosed(validPosedPhoto({ dateKey }), `${String(dateKey)}_front`),
      );
    });

  rejects('rejects a non padded date', '2026-8-1');
  rejects('rejects a reversed date', '15-08-2026');
  rejects('rejects a slash separated date', '2026/08/15');
  rejects('rejects an impossible month', '2026-13-01');
  rejects('rejects an impossible day', '2026-08-32');
  rejects('rejects a timestamp in place of the key', 1_755_000_000);
  rejects('rejects an empty dateKey', '');

  it('rejects a day far in the future', async () => {
    await assertFails(
      createPosed(validPosedPhoto({ dateKey: '2099-01-01' }), '2099-01-01_front'),
    );
  });

  it('rejects a posed document with no dateKey', async () => {
    const { dateKey: _omitted, ...withoutDateKey } = validPosedPhoto();
    await assertFails(createPosed(withoutDateKey));
  });
});

describe('progressPhotos — posed assetId validation', () => {
  it('rejects an assetId that is not a uuid', async () => {
    await assertFails(
      createPosed(
        validPosedPhoto({
          assetId: 'not-a-uuid',
          storagePath: `users/${UID}/progressPhotos/not-a-uuid.enc`,
          thumbnailStoragePath: `users/${UID}/progressPhotos/not-a-uuid.thumb.enc`,
        }),
      ),
    );
  });

  it('rejects a posed document with no assetId', async () => {
    const { assetId: _omitted, ...withoutAssetId } = validPosedPhoto();
    await assertFails(createPosed(withoutAssetId));
  });

  it('rejects a storagePath pointing at a different asset', async () => {
    await assertFails(
      createPosed(
        validPosedPhoto({
          storagePath: `users/${UID}/progressPhotos/${OTHER_ASSET_ID}.enc`,
        }),
      ),
    );
  });

  it('rejects a thumbnailStoragePath pointing at a different asset', async () => {
    await assertFails(
      createPosed(
        validPosedPhoto({
          thumbnailStoragePath: `users/${UID}/progressPhotos/${OTHER_ASSET_ID}.thumb.enc`,
        }),
      ),
    );
  });

  it('rejects a storagePath named after the document instead of the asset', async () => {
    await assertFails(
      createPosed(
        validPosedPhoto({
          storagePath: `users/${UID}/progressPhotos/${POSED_ID}.enc`,
        }),
      ),
    );
  });
});

describe('progressPhotos — posed schema is closed', () => {
  it('rejects an unknown extra field', async () => {
    await assertFails(createPosed(validPosedPhoto({ bodyPart: 'chest' })));
  });

  it('rejects a posed document missing its thumbnail fields', async () => {
    const {
      thumbnailStoragePath: _a,
      thumbnailEncryptedSize: _b,
      thumbnailEncryption: _c,
      ...withoutThumbnail
    } = validPosedPhoto();
    await assertFails(createPosed(withoutThumbnail));
  });

  it('rejects a forged createdAt', async () => {
    await assertFails(
      createPosed(validPosedPhoto({ createdAt: Timestamp.fromDate(new Date('2020-01-01')) })),
    );
  });

  it('rejects a takenAt in the future', async () => {
    await assertFails(
      createPosed(
        validPosedPhoto({ takenAt: Timestamp.fromDate(new Date('2099-01-01')) }),
      ),
    );
  });

  it('rejects thumbnail nonce reuse', async () => {
    await assertFails(
      createPosed(
        validPosedPhoto({
          thumbnailEncryption: {
            version: 1,
            algorithm: 'AES-256-GCM',
            iv: 'YWJjZGVmZ2hpamts',
            vaultKeyVersion: 1,
          },
        }),
      ),
    );
  });

  it('keeps posed documents immutable', async () => {
    await assertSucceeds(createPosed(validPosedPhoto()));
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', POSED_ID), {
        pose: 'side',
      }),
    );
  });
});

describe('progressPhotos — posed cross-user isolation', () => {
  it('refuses a posed document written into another user namespace', async () => {
    await assertFails(
      setDoc(
        doc(otherDb(), 'users', UID, 'progressPhotos', POSED_ID),
        validPosedPhoto(),
      ),
    );
  });

  it('refuses paths that point at another user asset', async () => {
    await assertFails(
      createPosed(
        validPosedPhoto({
          storagePath: `users/${OTHER_UID}/progressPhotos/${ASSET_ID}.enc`,
          thumbnailStoragePath: `users/${OTHER_UID}/progressPhotos/${ASSET_ID}.thumb.enc`,
        }),
      ),
    );
  });

  it('allows the owner to delete and read a posed document', async () => {
    await assertSucceeds(createPosed(validPosedPhoto()));
    await assertSucceeds(
      getDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', POSED_ID)),
    );
    await assertSucceeds(
      deleteDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', POSED_ID)),
    );
  });
});

describe('progressPhotos — earlier shapes still accepted', () => {
  it('still accepts the six-field legacy shape', async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID), validPhoto()),
    );
  });

  it('still accepts the phase-13 thumbnail shape', async () => {
    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID),
        validPhotoWithThumbnail(),
      ),
    );
  });

  it('still rejects pose or dateKey grafted onto an earlier shape', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID),
        validPhotoWithThumbnail({ pose: 'front' }),
      ),
    );
    await assertFails(
      setDoc(
        doc(ownerDb(), 'users', UID, 'progressPhotos', PHOTO_ID),
        validPhoto({ dateKey: DATE_KEY }),
      ),
    );
  });
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
