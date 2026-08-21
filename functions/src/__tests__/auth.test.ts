import { describe, expect, it } from 'vitest';

import {
  RECENT_AUTH_MAX_AGE_SECONDS,
  requireAuth,
  requireRecentAuth,
  requireVerifiedEmailForPrivateAccess,
} from '../lib/auth';

describe('requireAuth', () => {
  it('returns the uid from a verified auth token', () => {
    const uid = requireAuth({ auth: { uid: 'user-123' } } as never);

    expect(uid).toBe('user-123');
  });

  it('rejects a request with no verified auth token', () => {
    expect(() => requireAuth({ auth: null } as never)).toThrow(
      'This function requires an authenticated user.',
    );
  });

  it('never trusts a uid supplied in request.data', () => {
    const uid = requireAuth({
      auth: { uid: 'real-uid-from-token' },
      data: { uid: 'attacker-supplied-uid' },
    } as never);

    expect(uid).toBe('real-uid-from-token');
  });
});

describe('requireVerifiedEmailForPrivateAccess', () => {
  const request = (token: Record<string, unknown>) =>
    ({ auth: { uid: 'alice', token }, data: {} }) as never;

  it('rejects an unverified Email/Password identity', () => {
    expect(() => requireVerifiedEmailForPrivateAccess(request({
      email_verified: false,
      firebase: { identities: { email: ['alice@example.com'] } },
    }))).toThrowError(expect.objectContaining({
      code: 'permission-denied',
      message: 'email_verification_required',
    }));
  });

  it('accepts a verified Email/Password identity', () => {
    expect(() => requireVerifiedEmailForPrivateAccess(request({
      email_verified: true,
      firebase: { identities: { email: ['alice@example.com'] } },
    }))).not.toThrow();
  });

  it.each(['google.com', 'apple.com'])('accepts a social-only %s identity', (provider) => {
    expect(() => requireVerifiedEmailForPrivateAccess(request({
      email_verified: false,
      firebase: { identities: { [provider]: ['provider-subject'] } },
    }))).not.toThrow();
  });

  it('rejects an unverified linked password + social identity', () => {
    expect(() => requireVerifiedEmailForPrivateAccess(request({
      email_verified: false,
      firebase: {
        identities: {
          email: ['alice@example.com'],
          'google.com': ['provider-subject'],
        },
      },
    }))).toThrowError(expect.objectContaining({ code: 'permission-denied' }));
  });

  it('rejects an unauthenticated request', () => {
    expect(() => requireVerifiedEmailForPrivateAccess({ auth: null } as never))
      .toThrowError(expect.objectContaining({ code: 'unauthenticated' }));
  });
});

describe('requireRecentAuth', () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  /** A verified token minted `ageSeconds` ago. */
  const request = (ageSeconds: number, data: unknown = {}) =>
    ({ auth: { uid: 'alice', token: { auth_time: nowSeconds() - ageSeconds } }, data }) as never;

  it('accepts a caller who just authenticated', () => {
    expect(requireRecentAuth(request(0))).toBe('alice');
  });

  it('accepts a token inside the window', () => {
    expect(requireRecentAuth(request(RECENT_AUTH_MAX_AGE_SECONDS - 5))).toBe('alice');
  });

  it('rejects a token past the window', () => {
    expect(() => requireRecentAuth(request(RECENT_AUTH_MAX_AGE_SECONDS + 5))).toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });

  it('rejects before checking freshness when unauthenticated', () => {
    expect(() => requireRecentAuth({ auth: null, data: {} } as never)).toThrowError(
      expect.objectContaining({ code: 'unauthenticated' }),
    );
  });

  it.each([undefined, null, 'now', NaN, Infinity, -Infinity])(
    'fails closed for auth_time %s',
    (authTime) => {
      const req = { auth: { uid: 'alice', token: { auth_time: authTime } }, data: {} } as never;

      expect(() => requireRecentAuth(req)).toThrowError(
        expect.objectContaining({ code: 'failed-precondition' }),
      );
    },
  );

  it('fails closed on an implausibly future auth_time', () => {
    expect(() => requireRecentAuth(request(-3600))).toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });

  it('tolerates minor clock skew', () => {
    expect(requireRecentAuth(request(-10))).toBe('alice');
  });

  it('honours a caller-supplied window', () => {
    expect(requireRecentAuth(request(30), 60)).toBe('alice');
    expect(() => requireRecentAuth(request(90), 60)).toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });

  it('ignores a freshness claim planted in the request body', () => {
    const req = {
      auth: { uid: 'alice', token: { auth_time: nowSeconds() - 86_400 } },
      data: { auth_time: nowSeconds(), reauthenticated: true },
    } as never;

    expect(() => requireRecentAuth(req)).toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });

  it('keeps the window short enough to be meaningful', () => {
    // A long window would defeat the purpose: a stolen device with a live
    // session must not be able to extract the vault key.
    expect(RECENT_AUTH_MAX_AGE_SECONDS).toBeLessThanOrEqual(15 * 60);
  });
});
