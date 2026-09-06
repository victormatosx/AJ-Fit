/**
 * REPRODUCTION (temporary, diagnostic) — controlled reproduction of
 * Cenários A/B/C requested while investigating the real deletion of
 * uid JsK…tK2 (masked, matches Cloud Logging's own masking) and the
 * originally-reported "keeps asking for the password" loop.
 *
 * Cenário D (backend rejects a stale token) and the backend half of
 * Cenário B (a REAL password-reauth token, verified by Admin SDK, fed into
 * the REAL, unmodified `requireRecentAuth`) are NOT duplicated here — they
 * are already covered by
 * `functions/src/accountDeletion/__tests__/requireRecentAuthPasswordReauth.integration.test.ts`
 * and `functions/src/accountDeletion/__tests__/requestAccountDeletion.test.ts`'s
 * stale-token tests. Importing the real client app source (`../accountDeletionReauth`)
 * from inside `functions/` breaks `tsc --noEmit` there (`rootDir: "src"` in
 * `functions/tsconfig.json` rejects files outside `functions/src`) — this
 * file stays in the ROOT project instead, where the real app source already
 * lives and root `tsconfig.json` has no such restriction.
 *
 * Everything here runs against the LOCAL Firebase Auth Emulator only
 * (`connectAuthEmulator('http://127.0.0.1:9099')`). Nothing writes to, or
 * reads from, any production project. No production security window is
 * touched: `CLIENT_RECENT_AUTH_MAX_AGE_MS` (`../../lib/recentAuth.ts`) is
 * used completely unmodified, at its real production value.
 *
 * "Old" client-side authentication is simulated WITHOUT waiting real
 * minutes: `Date.now()` is spied (`vi.spyOn(Date, 'now')`) only around the
 * `hasRecentAuth`/`needsAccountDeletionReauthentication` freshness check
 * itself, then immediately restored before any real network call
 * (reauthentication). This never fakes the Auth Emulator's own server
 * clock — the emulator always mints tokens with a real, correct `auth_time`
 * reflecting the moment the reauth REST call actually happened. Only the
 * CLIENT's "is this fresh enough to skip the password screen" arithmetic is
 * tricked into seeing a stale session — the exact same class of check
 * `hasRecentAuth` performs in the real app, pointed at a real backend.
 *
 * Skipped by default — only runs when
 * `ACCOUNT_DELETION_SCENARIOS_EMULATOR_INTEGRATION=1` is set.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type Auth } from 'firebase/auth';

const enabled = process.env.ACCOUNT_DELETION_SCENARIOS_EMULATOR_INTEGRATION === '1';

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

async function createPasswordUser(label: string) {
  const email = `scenario-${label}-${Date.now()}@example.test`;
  const password = 'Sup3rSecret!diag';
  const created = await createUserWithEmailAndPassword(realAuth, email, password);
  return { email, password, uid: created.user.uid };
}

/** Makes `Date.now()` (and therefore `hasRecentAuth`) see `minutesAhead` minutes in the future, for the duration of `fn` only — never touches the Auth Emulator's own server clock. */
async function withClientClockAdvanced<T>(minutesAhead: number, fn: () => Promise<T>): Promise<T> {
  const realNow = Date.now();
  const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow + minutesAhead * 60_000);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

describe.skipIf(!enabled)('Account deletion — controlled scenario reproduction (Auth Emulator)', () => {
  beforeAll(() => {
    clientApp = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'ajfit-rules-test' },
      'account-deletion-scenarios-client',
    );
    realAuth = getAuth(clientApp);
    connectAuthEmulator(realAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  });

  afterAll(async () => {
    await deleteApp(clientApp);
  });

  it('Cenário A — fresh auth: needsAccountDeletionReauthentication() resolves false, reauth screen is skipped', async () => {
    const { needsAccountDeletionReauthentication } = await import('../accountDeletionReauth');
    await createPasswordUser('a');

    const needsReauth = await needsAccountDeletionReauthentication();
    expect(needsReauth).toBe(false);
  });

  it('Cenário B (client half) — stale client auth + correct password: reauth is required, succeeds, auth_time becomes fresh again', async () => {
    const { needsAccountDeletionReauthentication, startAccountDeletionReauthentication } = await import(
      '../accountDeletionReauth'
    );
    const { uid, password } = await createPasswordUser('b');

    // Simulate the client clock 6 minutes ahead — past CLIENT_RECENT_AUTH_MAX_AGE_MS (4min) —
    // WITHOUT actually waiting. The emulator's own clock is untouched.
    const needsReauth = await withClientClockAdvanced(6, () => needsAccountDeletionReauthentication());
    expect(needsReauth).toBe(true); // app WOULD show the password screen here

    // User types the correct password. This is a REAL, un-faked call — real
    // wall-clock time, real Auth Emulator round trip.
    const outcome = await startAccountDeletionReauthentication({ provider: 'password', password });
    expect(outcome.status).toBe('completed');
    expect(outcome.uid).toBe(uid);

    const nowS = Math.floor(Date.now() / 1000);
    expect(Math.abs(outcome.authTimeSeconds - nowS)).toBeLessThanOrEqual(3);

    // A token this fresh is, independently, already proven acceptable by
    // the REAL backend gate in
    // functions/src/accountDeletion/__tests__/requireRecentAuthPasswordReauth.integration.test.ts
    // (not re-imported here to avoid a cross-package rootDir violation).
  });

  it('Cenário C — stale client auth + wrong password: reauth is required and fails with WRONG_PASSWORD, nothing proceeds', async () => {
    const {
      needsAccountDeletionReauthentication,
      startAccountDeletionReauthentication,
      AccountDeletionReauthError,
    } = await import('../accountDeletionReauth');
    await createPasswordUser('c');

    const needsReauth = await withClientClockAdvanced(6, () => needsAccountDeletionReauthentication());
    expect(needsReauth).toBe(true);

    await expect(
      startAccountDeletionReauthentication({ provider: 'password', password: 'definitely-wrong' }),
    ).rejects.toMatchObject(new AccountDeletionReauthError('WRONG_PASSWORD'));
  });
});
