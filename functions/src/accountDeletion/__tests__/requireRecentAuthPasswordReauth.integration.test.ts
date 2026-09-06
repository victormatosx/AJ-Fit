/**
 * DIAGNOSTIC (temporary) — investigating the "Excluir Conta" password-reauth
 * loop reported for email/password users (Apple/Google unaffected).
 *
 * The audit's hypothesis was that `reauthenticateWithCredential()` with an
 * `EmailAuthProvider` credential does not refresh the `auth_time` claim the
 * way federated (Google/Apple) reauth does, so `requireRecentAuth` on the
 * backend always sees a stale timestamp and rejects with
 * `failed-precondition`, bouncing the client back to the password screen.
 *
 * This test reproduces the REAL handoff end-to-end against the Auth
 * Emulator: the exact client-SDK call sequence the app uses
 * (`EmailAuthProvider.credential` + `reauthenticateWithCredential` +
 * `getIdTokenResult(true)`, mirroring `accountDeletionReauth.ts`'s
 * `finalizeReauthentication`), the resulting ID token verified the same way
 * Callable Functions verifies it (`admin.auth().verifyIdToken`), and the
 * REAL, unmodified `requireRecentAuth` from `../../lib/auth` deciding
 * whether to accept it — no mocks on either side of the boundary being
 * tested.
 *
 * Skipped by default — only runs when
 * `REQUIRE_RECENT_AUTH_PASSWORD_INTEGRATION=1` is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth as getAdminAuth, type Auth as AdminAuth } from 'firebase-admin/auth';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  createUserWithEmailAndPassword,
  connectAuthEmulator,
  EmailAuthProvider,
  getAuth as getClientAuth,
  reauthenticateWithCredential,
  signOut,
  type Auth as ClientAuth,
} from 'firebase/auth';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp, type FirebaseApp } from 'firebase/app';

import { requireRecentAuth } from '../../lib/auth';

const enabled = process.env.REQUIRE_RECENT_AUTH_PASSWORD_INTEGRATION === '1';

function buildCallableRequest(uid: string, token: Record<string, unknown>): CallableRequest {
  return {
    auth: { uid, token } as CallableRequest['auth'],
  } as CallableRequest;
}

describe.skipIf(!enabled)('requireRecentAuth vs real password reauth — Auth Emulator integration', () => {
  let adminApp: App;
  let adminAuth: AdminAuth;
  let clientApp: FirebaseApp;
  let clientAuth: ClientAuth;

  beforeAll(() => {
    adminApp = initializeApp({ projectId: 'ajfit-rules-test' }, 'require-recent-auth-password-admin');
    adminAuth = getAdminAuth(adminApp);

    clientApp = initializeClientApp(
      { apiKey: 'fake-api-key', projectId: 'ajfit-rules-test' },
      'require-recent-auth-password-client',
    );
    clientAuth = getClientAuth(clientApp);
    connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  });

  afterAll(async () => {
    await deleteApp(adminApp);
    await deleteClientApp(clientApp);
  });

  it(
    'password reauth several seconds after signup produces an auth_time requireRecentAuth accepts',
    async () => {
      const email = `require-recent-auth-password-${Date.now()}@example.test`;
      const password = 'Sup3rSecret!diag';

      const created = await createUserWithEmailAndPassword(clientAuth, email, password);
      const uid = created.user.uid;

      // Simulate the user taking real time to read the screen / type the
      // password before submitting — comfortably inside the 300s window,
      // but enough to prove auth_time tracks "now", not the original signup.
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const beforeReauthEpochS = Math.floor(Date.now() / 1000);

      // Exactly the app's sequence: reauthenticateCurrentUser (password
      // branch) -> finalizeReauthentication's forced getIdTokenResult(true).
      const credential = EmailAuthProvider.credential(email, password);
      const reauthResult = await reauthenticateWithCredential(created.user, credential);
      expect(reauthResult.user.uid).toBe(uid);

      const forcedRefresh = await clientAuth.currentUser!.getIdTokenResult(true);
      const idToken = await clientAuth.currentUser!.getIdToken();

      // Verify the SAME way Callable Functions verifies the caller's token
      // before populating `request.auth.token`.
      const decoded = await adminAuth.verifyIdToken(idToken);
      expect(decoded.uid).toBe(uid);

      const clientObservedAuthTimeS = Math.floor(Date.parse(forcedRefresh.authTime) / 1000);
      const serverObservedAuthTimeS = decoded.auth_time;

      // Both should reflect "now" (the reauth moment), not the original signup.
      expect(Math.abs(clientObservedAuthTimeS - beforeReauthEpochS)).toBeLessThanOrEqual(2);
      expect(Math.abs(serverObservedAuthTimeS - beforeReauthEpochS)).toBeLessThanOrEqual(2);

      // The real, unmodified backend gate.
      const request = buildCallableRequest(uid, decoded as unknown as Record<string, unknown>);
      expect(() => requireRecentAuth(request)).not.toThrow();

      await signOut(clientAuth);
    },
    30_000,
  );
});
