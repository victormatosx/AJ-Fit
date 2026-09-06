/**
 * DIAGNOSTIC (temporary) — closes the gap the raw-SDK auth_time probe left
 * open: that probe proved the Firebase Auth Emulator itself refreshes
 * `auth_time` correctly for a password `reauthenticateWithCredential` call.
 * This test proves (or disproves) that OUR wrapper code around it —
 * `reauthenticatePasswordUser` (`../password.ts`), `reauthenticateCurrentUser`
 * (`../reauthentication.ts`), and `startAccountDeletionReauthentication`
 * (`../accountDeletionReauth.ts`) — doesn't itself throw/misbehave for a
 * real, valid password reauth. Only `../lib/firebase`'s `auth` export is
 * swapped for a real emulator-connected Auth instance and the native
 * Google/Apple provider modules are stubbed (unused on this path, but
 * `reauthentication.ts` imports them at module load time); every other
 * module under test is REAL, unmocked source.
 *
 * Skipped by default — only runs when
 * `ACCOUNT_DELETION_PASSWORD_REAUTH_EMULATOR_INTEGRATION=1` is set.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  type Auth,
} from 'firebase/auth';

const enabled = process.env.ACCOUNT_DELETION_PASSWORD_REAUTH_EMULATOR_INTEGRATION === '1';

let clientApp: FirebaseApp;
let realAuth: Auth;

vi.mock('../../lib/firebase', () => ({
  get auth() {
    return realAuth;
  },
}));
vi.mock('../providers/google.native', () => ({ getGoogleCredential: vi.fn() }));
vi.mock('../providers/apple.native', () => ({
  getAppleCredential: vi.fn(),
  getAppleCredentialForAccountDeletion: vi.fn(),
}));
// `password.ts` only needs these two named exports from `./auth`
// (`services/auth.ts`) — the rest of that module pulls in AsyncStorage/
// react-native transitively, which Vitest's plain Node environment can't
// parse. Behavior is copied verbatim (not reimplemented) so the test still
// exercises the real error-code-preservation semantics `password.ts` and
// `accountDeletionReauth.ts`'s `mapReauthError` rely on.
vi.mock('../auth', () => ({
  logAuthError: () => {},
  toAuthError: (err: unknown) => {
    const code =
      typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
    const friendly = new Error(code || 'unknown');
    if (code) (friendly as Error & { code?: string }).code = code;
    return friendly;
  },
}));

describe.skipIf(!enabled)('startAccountDeletionReauthentication(password) — real Auth Emulator, real wrapper code', () => {
  beforeAll(() => {
    clientApp = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'ajfit-rules-test' },
      'account-deletion-password-wrapper-integration',
    );
    realAuth = getAuth(clientApp);
    connectAuthEmulator(realAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  });

  afterAll(async () => {
    await deleteApp(clientApp);
  });

  it('a real, currently-linked password user reauthenticates successfully through the unmodified app code path', async () => {
    const { startAccountDeletionReauthentication } = await import('../accountDeletionReauth');

    const email = `wrapper-password-${Date.now()}@example.test`;
    const password = 'Sup3rSecret!diag';
    const created = await createUserWithEmailAndPassword(realAuth, email, password);
    const uid = created.user.uid;

    const outcome = await startAccountDeletionReauthentication({ provider: 'password', password });

    expect(outcome.status).toBe('completed');
    expect(outcome.uid).toBe(uid);
    expect(Math.abs(outcome.authTimeSeconds - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(3);
  }, 30_000);

  it('wrong password surfaces WRONG_PASSWORD, not a silent generic loop', async () => {
    const { startAccountDeletionReauthentication, AccountDeletionReauthError } = await import(
      '../accountDeletionReauth'
    );

    const email = `wrapper-password-wrong-${Date.now()}@example.test`;
    await createUserWithEmailAndPassword(realAuth, email, 'Sup3rSecret!diag');

    await expect(
      startAccountDeletionReauthentication({ provider: 'password', password: 'totally-wrong-password' }),
    ).rejects.toMatchObject(
      new AccountDeletionReauthError('WRONG_PASSWORD'),
    );
  }, 30_000);
});
