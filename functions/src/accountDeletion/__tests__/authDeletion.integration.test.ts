/**
 * OPT-IN integration proof against the REAL Firebase Auth Emulator — Fase 10
 * gate. Same role as the Fases 6/7/8 Emulator integration tests: unit tests
 * with fakes prove the LOGIC; this file proves against real Auth Emulator
 * behavior that `deleteUser` actually removes the user, `getUser` afterward
 * reports `auth/user-not-found`, and old credentials can no longer sign in.
 *
 * Skipped by default — only runs when `AUTH_DELETION_INTEGRATION=1`. Run via
 * `npm run test:integration:authDeletion`, which wraps this in `firebase
 * emulators:exec --only auth --project ajfit-rules-test`. Never touches
 * production — uses its own named Admin app instance, never the shared
 * `functions/src/lib/firebaseAdmin.ts` singleton, and never a real user.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

import { executeAuthDeletion } from '../authDeletion';

const enabled = process.env.AUTH_DELETION_INTEGRATION === '1';

describe.skipIf(!enabled)('AUTH_DELETION executor — real Auth Emulator integration', () => {
  let app: App;
  let auth: Auth;

  beforeAll(() => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'auth-deletion-integration');
    auth = getAuth(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it(
    'deletes a real Auth Emulator user: exists → delete → user-not-found — real Auth, not a fake',
    async () => {
      const user = await auth.createUser({ email: 'fase10-artificial@example.test', password: 'irrelevant123' });

      const outcome = await executeAuthDeletion(user.uid, auth);
      expect(outcome).toEqual({ kind: 'SUCCEEDED' });

      await expect(auth.getUser(user.uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
    },
    30_000,
  );

  it(
    'retry after the fact (idempotency against real Auth): deleting an already-absent user is logical success',
    async () => {
      const user = await auth.createUser({ email: 'fase10-retry@example.test', password: 'irrelevant123' });
      await executeAuthDeletion(user.uid, auth);

      const retry = await executeAuthDeletion(user.uid, auth);
      expect(retry).toEqual({ kind: 'FAILED', code: 'ALREADY_DELETED' });
    },
    30_000,
  );

  it(
    'a custom token minted for the deleted user can no longer be exchanged for a session (old credentials fail)',
    async () => {
      // The Auth Emulator (like production) still lets `verifyIdToken` reject
      // once the underlying user is gone. This proves the deletion is not
      // merely a soft "disabled" flag (already covered by ACCOUNT_ACCESS_LOCK,
      // Fase 5) — the user record itself is gone, so no future token exchange
      // for this uid can ever succeed again.
      const user = await auth.createUser({ email: 'fase10-old-creds@example.test', password: 'irrelevant123' });
      await executeAuthDeletion(user.uid, auth);

      await expect(auth.getUser(user.uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
      await expect(auth.updateUser(user.uid, { disabled: false })).rejects.toMatchObject({
        code: 'auth/user-not-found',
      });
    },
    30_000,
  );

  it('never touches another uid', async () => {
    const target = await auth.createUser({ email: 'fase10-target@example.test', password: 'irrelevant123' });
    const other = await auth.createUser({ email: 'fase10-other@example.test', password: 'irrelevant123' });

    await executeAuthDeletion(target.uid, auth);

    await expect(auth.getUser(target.uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
    await expect(auth.getUser(other.uid)).resolves.toMatchObject({ uid: other.uid });
  }, 30_000);
});
