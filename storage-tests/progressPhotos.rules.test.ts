/**
 * Storage Rules — behavioral tests for the Photo Vault encrypted objects
 * (docs/20_backend_functions_photo_vault.md), plus regression coverage for
 * the profile avatar path. Support attachment coverage lives in
 * `storage-tests/supportV2.rules.test.ts` (Support V1's
 * `users/{uid}/support/{ticketId}/attachments/*` path has been removed).
 *
 * Executed against the Storage emulator. See the `test:rules` npm script.
 * FASE 7 (docs/13_assinaturas_e_billing.md §10/§11): `storage.rules`'
 * `hasServerPremium()` reads `users/{uid}.subscription.entitlementActive`
 * via Cloud Storage for Firebase's cross-service Firestore access — this
 * file now ALSO needs a live Firestore emulator (see
 * `vitest.storage.config.mts`'s updated doc comment and the
 * `test:rules`/`test:rules:storage` npm scripts, both of which start
 * `--only firestore,storage` now) and a second, independent
 * `RulesTestEnvironment` purely to seed that Firestore state — Storage's
 * own `RulesTestEnvironment` has no `firestore()` accessor since its config
 * below only declares `storage:`.
 *
 * Note: `@firebase/rules-unit-testing` exposes Storage only through the
 * firebase compat (v8-style) API, hence `ref().put()` instead of the modular
 * `uploadBytes()` used elsewhere in the app.
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
import { doc, setDoc } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const OTHER_UID = 'mallory';
const PHOTO_ID = 'photo-001';
const PHOTO_PATH = `users/${UID}/progressPhotos/${PHOTO_ID}.enc`;
const THUMBNAIL_PATH = `users/${UID}/progressPhotos/${PHOTO_ID}.thumb.enc`;

const OCTET_STREAM = 'application/octet-stream';

let testEnv: RulesTestEnvironment;

function ownerStorage() {
  return testEnv.authenticatedContext(UID, { email: 'alice@example.com' }).storage();
}
function otherStorage() {
  return testEnv.authenticatedContext(OTHER_UID, { email: 'mallory@example.com' }).storage();
}
function anonStorage() {
  return testEnv.unauthenticatedContext().storage();
}

type Storage = ReturnType<typeof ownerStorage>;
type UploadMetadata = Parameters<ReturnType<Storage['ref']>['put']>[1];

/**
 * The compat `UploadTask` is thenable but not a full `Promise` (it has no
 * `finally`), which `assertSucceeds`/`assertFails` require. `Promise.resolve`
 * adopts it — including its rejection — into a real Promise.
 */
function put(
  storage: Storage,
  path: string,
  data: Uint8Array,
  metadata?: UploadMetadata,
): Promise<unknown> {
  return Promise.resolve(storage.ref(path).put(data, metadata));
}

/** Opaque ciphertext stand-in. Content is irrelevant — the rules only see size/type. */
function ciphertext(bytes = 1024): Uint8Array {
  return new Uint8Array(bytes);
}

function photoMetadata(overrides: Record<string, string> = {}) {
  return {
    contentType: OCTET_STREAM,
    customMetadata: {
      ownerId: UID,
      photoId: PHOTO_ID,
      ...overrides,
    },
  };
}

function thumbnailMetadata(overrides: Record<string, string> = {}) {
  return photoMetadata({ assetKind: 'thumbnail', ...overrides });
}

/** Seeds an existing encrypted object bypassing rules (baseline for read/update/delete). */
async function seedPhoto(path = PHOTO_PATH) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref(path).put(ciphertext(), photoMetadata());
  });
}

/** FASE 7: seeding-only Firestore environment — see this file's top comment. */
let testEnvFirestore: RulesTestEnvironment;

async function seedPremium(uid: string) {
  await testEnvFirestore.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'users', uid),
      { subscription: { entitlementActive: true } },
      { merge: true },
    );
  });
}

/** Sets the mirror to explicitly Free — a real `entitlementActive: false`, not merely absent. */
async function seedFree(uid: string) {
  await testEnvFirestore.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'users', uid),
      { subscription: { entitlementActive: false } },
      { merge: true },
    );
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: readFileSync(resolve(__dirname, '../storage.rules'), 'utf8'),
    },
  });
  testEnvFirestore = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
  await testEnvFirestore.cleanup();
});

/**
 * Deletes every object in the bucket, including nested ones.
 *
 * `testEnv.clearStorage()` cannot be used here: it calls `listAll()` once on
 * the bucket root and deletes only the returned `items`, discarding the
 * `prefixes`. Every object in this suite lives under `users/{uid}/…`, so that
 * helper clears nothing and objects leak from one case into the next.
 *
 * That leak was invisible for as long as every case following an upload
 * asserted a DENIAL — a leftover object denies the next create too (via
 * `resource == null`), so those cases passed for the wrong reason. Any case
 * asserting that an upload SUCCEEDS exposes it immediately.
 */
async function clearStorageRecursively() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const removeUnder = async (folder: ReturnType<Storage['ref']>): Promise<void> => {
      const { items, prefixes } = await folder.listAll();
      await Promise.all(items.map((item) => item.delete()));
      await Promise.all(prefixes.map(removeUnder));
    };
    await removeUnder(ctx.storage().ref());
  });
}

beforeEach(async () => {
  await clearStorageRecursively();
  await testEnvFirestore.clearFirestore();
  // Every pre-existing test in this file exercises Storage schema/
  // ownership, not billing — Premium is a given precondition for those, not
  // what they're testing. Dedicated FASE 7 describe blocks below call
  // `seedFree` instead.
  await seedPremium(UID);
  await seedPremium(OTHER_UID);
});

// ── progressPhotos: owner happy path ───────────────────────────────────────

describe('progressPhotos storage — owner', () => {
  it('allows the owner to upload an encrypted photo to their own path', async () => {
    await assertSucceeds(
      put(ownerStorage(), PHOTO_PATH, ciphertext(), photoMetadata()),
    );
  });

  it('allows the owner to upload the independently encrypted thumbnail', async () => {
    await assertSucceeds(
      put(ownerStorage(), THUMBNAIL_PATH, ciphertext(120_000), thumbnailMetadata()),
    );
  });

  it('allows the owner to read their own encrypted photo', async () => {
    await seedPhoto();
    await assertSucceeds(ownerStorage().ref(PHOTO_PATH).getDownloadURL());
  });

  it('allows the owner to delete their own encrypted photo', async () => {
    await seedPhoto();
    await assertSucceeds(ownerStorage().ref(PHOTO_PATH).delete());
  });

  it('allows an object exactly at the 10 MB ceiling', async () => {
    await assertSucceeds(
      put(ownerStorage(), PHOTO_PATH, ciphertext(10 * 1024 * 1024), photoMetadata()),
    );
  });
});

// ── progressPhotos: cross-user isolation ───────────────────────────────────

describe('progressPhotos storage — cross-user isolation', () => {
  it("blocks another user from reading someone else's encrypted photo", async () => {
    await seedPhoto();
    await assertFails(otherStorage().ref(PHOTO_PATH).getDownloadURL());
  });

  it("blocks another user from uploading into someone else's path", async () => {
    await assertFails(
      put(otherStorage(), PHOTO_PATH, ciphertext(), photoMetadata()),
    );
  });

  it("blocks another user from uploading into someone else's path with their own metadata", async () => {
    await assertFails(
      put(otherStorage(), PHOTO_PATH, ciphertext(), photoMetadata({ ownerId: OTHER_UID })),
    );
  });

  it("blocks another user from deleting someone else's encrypted photo", async () => {
    await seedPhoto();
    await assertFails(otherStorage().ref(PHOTO_PATH).delete());
  });
});

// ── progressPhotos: unauthenticated ────────────────────────────────────────

describe('progressPhotos storage — unauthenticated', () => {
  it('blocks unauthenticated uploads', async () => {
    await assertFails(put(anonStorage(), PHOTO_PATH, ciphertext(), photoMetadata()));
  });

  it('blocks unauthenticated reads', async () => {
    await seedPhoto();
    await assertFails(anonStorage().ref(PHOTO_PATH).getDownloadURL());
  });

  it('blocks unauthenticated deletes', async () => {
    await seedPhoto();
    await assertFails(anonStorage().ref(PHOTO_PATH).delete());
  });
});

// ── progressPhotos: content type and size ──────────────────────────────────

describe('progressPhotos storage — content type and size', () => {
  it('rejects an image content type (the object must be opaque ciphertext)', async () => {
    await assertFails(
      put(ownerStorage(), PHOTO_PATH, ciphertext(), { ...photoMetadata(), contentType: 'image/jpeg' }),
    );
  });

  it('rejects a text content type', async () => {
    await assertFails(
      put(ownerStorage(), PHOTO_PATH, ciphertext(), { ...photoMetadata(), contentType: 'text/plain' }),
    );
  });

  it('rejects an object above the 10 MB ceiling', async () => {
    await assertFails(
      put(ownerStorage(), PHOTO_PATH, ciphertext(10 * 1024 * 1024 + 1), photoMetadata()),
    );
  });

  it('rejects a thumbnail above its independent 512 KiB ceiling', async () => {
    // The owner happy-path suite already proves an in-budget thumbnail is
    // accepted; this assertion isolates the independent upper bound.
    await assertFails(
      put(
        ownerStorage(),
        `users/${UID}/progressPhotos/photo-002.thumb.enc`,
        ciphertext(512 * 1024 + 1),
        {
          contentType: OCTET_STREAM,
          customMetadata: { ownerId: UID, photoId: 'photo-002', assetKind: 'thumbnail' },
        },
      ),
    );
  });

  it('rejects an empty object', async () => {
    await assertFails(put(ownerStorage(), PHOTO_PATH, ciphertext(0), photoMetadata()));
  });
});

// ── progressPhotos: metadata binding ───────────────────────────────────────

describe('progressPhotos storage — metadata binding', () => {
  it('rejects an ownerId that does not match the path uid', async () => {
    await assertFails(
      put(ownerStorage(), PHOTO_PATH, ciphertext(), photoMetadata({ ownerId: OTHER_UID })),
    );
  });

  it('rejects a photoId that does not match the file name', async () => {
    await assertFails(
      put(ownerStorage(), PHOTO_PATH, ciphertext(), photoMetadata({ photoId: 'photo-999' })),
    );
  });

  it('rejects thumbnail/full assetKind confusion and unknown metadata', async () => {
    await assertFails(
      put(ownerStorage(), THUMBNAIL_PATH, ciphertext(), photoMetadata({ assetKind: 'full' })),
    );
    await assertFails(
      put(ownerStorage(), PHOTO_PATH, ciphertext(), photoMetadata({ assetKind: 'thumbnail' })),
    );
    await assertFails(
      put(ownerStorage(), THUMBNAIL_PATH, ciphertext(), thumbnailMetadata({ extra: 'no' })),
    );
  });

  it('rejects a missing ownerId', async () => {
    await assertFails(
      put(ownerStorage(), PHOTO_PATH, ciphertext(), { contentType: OCTET_STREAM, customMetadata: { photoId: PHOTO_ID } }),
    );
  });

  it('rejects a missing photoId', async () => {
    await assertFails(
      put(ownerStorage(), PHOTO_PATH, ciphertext(), { contentType: OCTET_STREAM, customMetadata: { ownerId: UID } }),
    );
  });

  it('rejects an upload with no custom metadata at all', async () => {
    await assertFails(
      put(ownerStorage(), PHOTO_PATH, ciphertext(), { contentType: OCTET_STREAM }),
    );
  });

  it('rejects a file name missing the .enc suffix', async () => {
    await assertFails(
      put(ownerStorage(), `users/${UID}/progressPhotos/${PHOTO_ID}`, ciphertext(), photoMetadata()),
    );
  });
});

// ── progressPhotos: immutability ───────────────────────────────────────────

describe('progressPhotos storage — immutability', () => {
  it('rejects overwriting an existing encrypted photo', async () => {
    await seedPhoto();
    await assertFails(put(ownerStorage(), PHOTO_PATH, ciphertext(2048), photoMetadata()));
  });
});

// ── progressPhotos: path confinement ───────────────────────────────────────

describe('progressPhotos storage — path confinement', () => {
  it('rejects an upload directly under the user root', async () => {
    await assertFails(
      put(ownerStorage(), `users/${UID}/${PHOTO_ID}.enc`, ciphertext(), photoMetadata()),
    );
  });

  it('rejects an upload to an undeclared sibling folder', async () => {
    await assertFails(
      put(ownerStorage(), `users/${UID}/progressPhotosPublic/${PHOTO_ID}.enc`, ciphertext(), photoMetadata()),
    );
  });

  it('rejects an upload nested deeper than the declared path', async () => {
    await assertFails(
      put(ownerStorage(), `users/${UID}/progressPhotos/nested/${PHOTO_ID}.enc`, ciphertext(), photoMetadata()),
    );
  });

  it('rejects an upload outside the users/ namespace entirely', async () => {
    await assertFails(
      put(ownerStorage(), `progressPhotos/${PHOTO_ID}.enc`, ciphertext(), photoMetadata()),
    );
  });
});

// ── progressPhotos: authorization is ownership, never subscription ─────────
//
// The whole app sits behind the paywall, so an authenticated user reaching
// these paths is already a subscriber and the per-action check the FASE 7
// rules carried (`hasServerPremium`) was removed from storage.rules.
//
// These cases are the regression guard for that decision: the subscription
// mirror must have NO effect here. They fail the moment someone reintroduces
// a subscription read into this path — which would silently break every
// account whose mirror is stale or unwritten.

describe('progressPhotos storage — the subscription mirror never gates these paths', () => {
  it('allows an owner with an explicitly inactive mirror to upload a photo', async () => {
    await seedFree(UID);
    await assertSucceeds(put(ownerStorage(), PHOTO_PATH, ciphertext(), photoMetadata()));
  });

  it('allows an owner with an explicitly inactive mirror to upload a thumbnail', async () => {
    await seedFree(UID);
    await assertSucceeds(
      put(ownerStorage(), THUMBNAIL_PATH, ciphertext(120_000), thumbnailMetadata()),
    );
  });

  it('allows an owner with an explicitly inactive mirror to delete their photo', async () => {
    await seedPhoto();
    await seedFree(UID);
    await assertSucceeds(ownerStorage().ref(PHOTO_PATH).delete());
  });

  /**
   * The exact production state that motivated the removal: the RevenueCat
   * webhook had never been registered, so no `users/{uid}` document ever
   * carried a subscription mirror at all. Under the old rules this denied
   * every upload; ownership alone must not care.
   */
  it('allows the upload when users/{uid} has no subscription field at all', async () => {
    await testEnvFirestore.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`users/${UID}`).delete();
    });
    await assertSucceeds(put(ownerStorage(), PHOTO_PATH, ciphertext(), photoMetadata()));
  });

  it('still allows an owner to READ their existing encrypted photo', async () => {
    await seedPhoto();
    await seedFree(UID);
    await assertSucceeds(ownerStorage().ref(PHOTO_PATH).getDownloadURL());
  });
});

describe('progressPhotos storage — ownership is the real boundary', () => {
  it("denies a subscriber uploading into someone else's path", async () => {
    // OTHER_UID has an active mirror but does not own UID's namespace.
    await assertFails(put(otherStorage(), PHOTO_PATH, ciphertext(), photoMetadata()));
  });

  it("denies a subscriber deleting someone else's encrypted photo", async () => {
    await seedPhoto();
    await assertFails(otherStorage().ref(PHOTO_PATH).delete());
  });
});

// ── Regression: pre-existing paths keep their behavior ─────────────────────

describe('existing storage paths — regression coverage', () => {
  const AVATAR_PATH = `users/${UID}/profile/avatar`;
  const image = { contentType: 'image/jpeg' };

  it('allows the owner to upload their avatar', async () => {
    await assertSucceeds(put(ownerStorage(), AVATAR_PATH, ciphertext(), image));
  });

  it('FASE 7: still allows a Free owner to upload their avatar — Premium enforcement never reaches this path', async () => {
    await seedFree(UID);
    await assertSucceeds(put(ownerStorage(), AVATAR_PATH, ciphertext(), image));
  });

  it('FASE 7: still allows a Free owner to delete their avatar', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.storage().ref(AVATAR_PATH).put(ciphertext(), image);
    });
    await seedFree(UID);
    await assertSucceeds(ownerStorage().ref(AVATAR_PATH).delete());
  });

  it("blocks another user from uploading someone else's avatar", async () => {
    await assertFails(put(otherStorage(), AVATAR_PATH, ciphertext(), image));
  });

  it("blocks another user from reading someone else's avatar", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.storage().ref(AVATAR_PATH).put(ciphertext(), image);
    });
    await assertFails(otherStorage().ref(AVATAR_PATH).getDownloadURL());
  });

  it('rejects an avatar above the 5 MB ceiling', async () => {
    await assertFails(
      put(ownerStorage(), AVATAR_PATH, ciphertext(5 * 1024 * 1024 + 1), image),
    );
  });

  it('rejects a non-image avatar (octet-stream is only for the vault)', async () => {
    await assertFails(
      put(ownerStorage(), AVATAR_PATH, ciphertext(), { contentType: OCTET_STREAM }),
    );
  });

});
