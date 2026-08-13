import { describe, expect, it } from 'vitest';
import {
  emailVerificationIssueFromError,
  requiresEmailVerification,
} from '../emailVerification';

function user(providerIds: string[], emailVerified: boolean) {
  return {
    emailVerified,
    providerData: providerIds.map((providerId) => ({ providerId })),
  };
}

describe('requiresEmailVerification', () => {
  it('blocks password accounts while Firebase reports emailVerified=false', () => {
    expect(requiresEmailVerification(user(['password'], false))).toBe(true);
    expect(
      requiresEmailVerification(
        user(['google.com', 'password', 'apple.com'], false),
      ),
    ).toBe(true);
  });

  it('releases password accounts only after Firebase reports emailVerified=true', () => {
    const firebaseUser = user(['password'], false);
    expect(requiresEmailVerification(firebaseUser)).toBe(true);

    firebaseUser.emailVerified = true;
    expect(requiresEmailVerification(firebaseUser)).toBe(false);
  });

  it.each([
    [['google.com'], true],
    [['apple.com'], true],
    [['google.com'], false],
    [['apple.com'], false],
    [[], false],
  ])('does not block accounts without the password provider (%j)', (providers, verified) => {
    expect(requiresEmailVerification(user(providers as string[], verified))).toBe(false);
  });

  it('does not block a missing session', () => {
    expect(requiresEmailVerification(null)).toBe(false);
    expect(requiresEmailVerification(undefined)).toBe(false);
  });
});

describe('emailVerificationIssueFromError', () => {
  it.each([
    ['auth/too-many-requests', 'tooManyRequests'],
    ['auth/network-request-failed', 'network'],
    ['auth/no-current-user', 'sessionExpired'],
    ['auth/user-token-expired', 'sessionExpired'],
    ['auth/invalid-user-token', 'sessionExpired'],
    ['auth/user-disabled', 'sessionExpired'],
    ['auth/internal-error', 'generic'],
  ] as const)('maps %s to translated issue %s', (code, expected) => {
    expect(emailVerificationIssueFromError({ code })).toBe(expected);
  });
});
