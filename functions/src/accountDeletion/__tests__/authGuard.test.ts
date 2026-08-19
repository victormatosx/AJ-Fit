import { describe, expect, it } from 'vitest';

import { RECENT_AUTH_MAX_AGE_SECONDS, requireAccountDeletionAuthorization } from '../authGuard';

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A verified token minted `ageSeconds` ago, exactly like functions/src/__tests__/auth.test.ts's fixture. */
function request(ageSeconds: number, data: unknown = {}) {
  return { auth: { uid: 'alice', token: { auth_time: nowSeconds() - ageSeconds } }, data } as never;
}

describe('requireAccountDeletionAuthorization — the sole server-side gate', () => {
  it('accepts a caller with a fresh recent-auth token', () => {
    expect(requireAccountDeletionAuthorization(request(0))).toBe('alice');
  });

  it('accepts a token inside the recent-auth window', () => {
    expect(requireAccountDeletionAuthorization(request(RECENT_AUTH_MAX_AGE_SECONDS - 5))).toBe(
      'alice',
    );
  });

  describe('critical test: old token rejected -> reauth -> fresh token accepted', () => {
    it('rejects a stale token, and the SAME uid with a fresh token is accepted', () => {
      // TOKEN A — auth_time old.
      expect(() => requireAccountDeletionAuthorization(request(RECENT_AUTH_MAX_AGE_SECONDS + 1))).toThrowError(
        expect.objectContaining({ code: 'failed-precondition' }),
      );

      // "reauthenticateCurrentUser() -> forced token refresh" (client-side,
      // src/services/accountDeletionReauth.ts) is what would produce TOKEN B
      // in a real client. Here we simulate its effect directly: the SAME
      // verified auth_time claim, now recent.
      expect(requireAccountDeletionAuthorization(request(0))).toBe('alice');
    });
  });

  it('rejects an unauthenticated request before checking freshness', () => {
    expect(() =>
      requireAccountDeletionAuthorization({ auth: null, data: {} } as never),
    ).toThrowError(expect.objectContaining({ code: 'unauthenticated' }));
  });

  describe('bypass attempt: a malicious client calling the future endpoint directly with a stale token', () => {
    it('is rejected regardless of what the payload claims', () => {
      expect(() =>
        requireAccountDeletionAuthorization(
          request(RECENT_AUTH_MAX_AGE_SECONDS + 100, { reallyIPromise: true }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'failed-precondition' }));
    });
  });

  describe('forged-flag attempts', () => {
    it('rejects a payload claiming recentAuth: true — never used as proof', () => {
      expect(() =>
        requireAccountDeletionAuthorization(request(RECENT_AUTH_MAX_AGE_SECONDS + 1, { recentAuth: true })),
      ).toThrowError(expect.objectContaining({ code: 'failed-precondition' }));
    });

    it('rejects a payload claiming reauthenticated: true', () => {
      expect(() =>
        requireAccountDeletionAuthorization(
          request(RECENT_AUTH_MAX_AGE_SECONDS + 1, { reauthenticated: true }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'failed-precondition' }));
    });

    it('rejects a payload claiming a fresh authTime — auth_time only ever comes from the verified token', () => {
      expect(() =>
        requireAccountDeletionAuthorization(
          request(RECENT_AUTH_MAX_AGE_SECONDS + 1, { authTime: Date.now() }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'failed-precondition' }));
    });

    it('rejects a client-supplied uid even with an otherwise-fresh token', () => {
      expect(() =>
        requireAccountDeletionAuthorization(request(0, { uid: 'someone-elses-uid' })),
      ).toThrow(/uid/);
    });

    it('rejects a client-supplied policy even with an otherwise-fresh token', () => {
      expect(() =>
        requireAccountDeletionAuthorization(request(0, { policy: { retention: {} } })),
      ).toThrow(/policy/);
    });

    it('rejects a client-supplied workflowVersion even with an otherwise-fresh token', () => {
      expect(() => requireAccountDeletionAuthorization(request(0, { workflowVersion: 1 }))).toThrow(
        /workflowVersion/,
      );
    });

    it('rejects a client-supplied deletionId even with an otherwise-fresh token', () => {
      expect(() =>
        requireAccountDeletionAuthorization(request(0, { deletionId: 'del-fake' })),
      ).toThrow(/deletionId/);
    });

    it('checks the payload shape even before the token would have been rejected (defense-in-depth ordering)', () => {
      // Both an old token AND a forged field are present — the forged-field
      // rejection fires first, so the error message names the field, not
      // just "failed-precondition".
      expect(() =>
        requireAccountDeletionAuthorization(
          request(RECENT_AUTH_MAX_AGE_SECONDS + 1, { uid: 'attacker-uid' }),
        ),
      ).toThrow(/uid/);
    });
  });

  it('never derives the uid from anything other than the verified token', () => {
    const uid = requireAccountDeletionAuthorization(
      request(0, { somethingHarmless: 'ok' }),
    );
    expect(uid).toBe('alice');
  });
});
