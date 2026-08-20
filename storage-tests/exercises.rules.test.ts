/**
 * Storage Rules — execution videos for `exercises/{exerciseId}` (ajfit-admin
 * panel). Executed against the Storage emulator (`test:rules` npm script).
 *
 * Needs a live Firestore emulator too — `isExercisesAdmin()` in
 * storage.rules reads `users/{uid}.metadata.role` via Cloud Storage for
 * Firebase's cross-service Firestore access, same pattern as
 * `hasServerPremium`/`accountActive` (see progressPhotos.rules.test.ts's
 * top comment for the full rationale). A second, independent
 * `RulesTestEnvironment` seeds that Firestore state.
 *
 * `@firebase/rules-unit-testing` exposes Storage only through the firebase
 * compat (v8-style) API, hence `ref().put()`.
 *
 * Important production difference: the emulators do not model the IAM grant
 * required by cross-service rules. Run `npm run check:storage-iam` against the
 * deployment project as well; otherwise these authorization tests can pass
 * while every production `firestore.get`/`firestore.exists` fails closed.
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
import { doc, setDoc, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const ADMIN_UID = 'exercises-admin';
const EXERCISE_ID = 'barbell-back-squat';
const VERTICAL_PATH = `exercises/${EXERCISE_ID}/execution/vertical.webm`;
const HORIZONTAL_PATH = `exercises/${EXERCISE_ID}/execution/horizontal.webm`;

const WEBM = 'video/webm';
const MP4 = 'video/mp4';

let testEnv: RulesTestEnvironment;
let testEnvFirestore: RulesTestEnvironment;

function userStorage(uid: string) {
  return testEnv.authenticatedContext(uid).storage();
}
function anonStorage() {
  return testEnv.unauthenticatedContext().storage();
}

type Storage = ReturnType<typeof userStorage>;
type UploadMetadata = Parameters<ReturnType<Storage['ref']>['put']>[1];

/** Adopts the compat `UploadTask` into a real Promise (see progressPhotos.rules.test.ts). */
function put(storage: Storage, path: string, data: Uint8Array, metadata?: UploadMetadata): Promise<unknown> {
  return Promise.resolve(storage.ref(path).put(data, metadata));
}

function video(bytes = 1024): Uint8Array {
  return new Uint8Array(bytes);
}

async function seedRole(uid: string, role: 'user' | 'admin') {
  await testEnvFirestore.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      profile: { name: uid, email: `${uid}@example.com` },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: { role, createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
    });
  });
}

async function seedVideo(path = VERTICAL_PATH) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref(path).put(video(), { contentType: WEBM });
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
  await seedRole(UID, 'user');
  await seedRole(ADMIN_UID, 'admin');
});

describe('exercise videos storage — read', () => {
  it('allows a signed-in user to read an execution video', async () => {
    await seedVideo();
    await assertSucceeds(userStorage(UID).ref(VERTICAL_PATH).getDownloadURL());
  });

  it('blocks an unauthenticated user from reading an execution video', async () => {
    await seedVideo();
    await assertFails(anonStorage().ref(VERTICAL_PATH).getDownloadURL());
  });
});

describe('exercise videos storage — regular user write', () => {
  it('blocks a regular signed-in user from uploading a video', async () => {
    await assertFails(put(userStorage(UID), VERTICAL_PATH, video(), { contentType: WEBM }));
  });

  it('blocks a regular signed-in user from replacing an existing video', async () => {
    await seedVideo();
    await assertFails(put(userStorage(UID), VERTICAL_PATH, video(2048), { contentType: WEBM }));
  });

  it('blocks a regular signed-in user from deleting a video', async () => {
    await seedVideo();
    await assertFails(userStorage(UID).ref(VERTICAL_PATH).delete());
  });

  it('blocks an unauthenticated user from uploading a video', async () => {
    await assertFails(put(anonStorage(), VERTICAL_PATH, video(), { contentType: WEBM }));
  });
});

describe('exercise videos storage — admin write', () => {
  it('allows an admin to upload a valid vertical .webm', async () => {
    await assertSucceeds(put(userStorage(ADMIN_UID), VERTICAL_PATH, video(), { contentType: WEBM }));
  });

  it('allows an admin to upload a valid horizontal .webm', async () => {
    await assertSucceeds(put(userStorage(ADMIN_UID), HORIZONTAL_PATH, video(), { contentType: WEBM }));
  });

  it('allows an admin to replace an existing video at the same path', async () => {
    await seedVideo();
    await assertSucceeds(put(userStorage(ADMIN_UID), VERTICAL_PATH, video(2048), { contentType: WEBM }));
  });

  it('blocks an admin from uploading a non-webm content type', async () => {
    await assertFails(put(userStorage(ADMIN_UID), VERTICAL_PATH, video(), { contentType: MP4 }));
  });

  it('blocks an admin from uploading to a file name outside the allowed set', async () => {
    await assertFails(
      put(userStorage(ADMIN_UID), `exercises/${EXERCISE_ID}/execution/side.webm`, video(), { contentType: WEBM }),
    );
  });

  it('blocks an admin from uploading a file over the size ceiling', async () => {
    await assertFails(
      put(userStorage(ADMIN_UID), VERTICAL_PATH, video(101 * 1024 * 1024), { contentType: WEBM }),
    );
  });

  it('allows an admin to delete an existing video', async () => {
    await seedVideo();
    await assertSucceeds(userStorage(ADMIN_UID).ref(VERTICAL_PATH).delete());
  });
});
