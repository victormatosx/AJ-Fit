/**
 * Storage Rules — behavioral tests for the Photo Vault encrypted objects
 * (docs/20_backend_functions_photo_vault.md), plus regression coverage for
 * the two pre-existing paths (profile avatar and support attachments) that
 * had no Storage Rules tests at all until now.
 *
 * Executed against the Storage emulator. See the `test:rules` npm script.
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

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: readFileSync(resolve(__dirname, '../storage.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
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

// ── Regression: pre-existing paths keep their behavior ─────────────────────

describe('existing storage paths — regression coverage', () => {
  const AVATAR_PATH = `users/${UID}/profile/avatar`;
  const image = { contentType: 'image/jpeg' };

  it('allows the owner to upload their avatar', async () => {
    await assertSucceeds(put(ownerStorage(), AVATAR_PATH, ciphertext(), image));
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

  it('allows a support attachment with coherent metadata', async () => {
    await assertSucceeds(
      put(ownerStorage(), `users/${UID}/support/ticket-1/attachments/a.jpg`, ciphertext(), {
          contentType: 'image/jpeg',
          customMetadata: { ownerId: UID, ticketId: 'ticket-1' },
        }),
    );
  });

  it('rejects a support attachment whose ticketId does not match the path', async () => {
    await assertFails(
      put(ownerStorage(), `users/${UID}/support/ticket-1/attachments/a.jpg`, ciphertext(), {
          contentType: 'image/jpeg',
          customMetadata: { ownerId: UID, ticketId: 'ticket-2' },
        }),
    );
  });
});
