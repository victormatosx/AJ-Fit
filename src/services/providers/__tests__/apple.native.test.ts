import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderCredentialError,
  SocialAuthCancelledError,
} from '../types';

const mocks = vi.hoisted(() => ({
  digest: vi.fn(),
  oauthCredential: vi.fn(),
  providerIds: [] as string[],
  random: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: mocks.digest,
  getRandomValues: mocks.random,
}));
vi.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  isAvailableAsync: vi.fn().mockResolvedValue(true),
  signInAsync: mocks.signIn,
}));
vi.mock('firebase/auth', () => ({
  OAuthProvider: function OAuthProvider(providerId: string) {
    mocks.providerIds.push(providerId);
    return { credential: mocks.oauthCredential };
  },
}));

import { getAppleCredential } from '../apple.native';

describe('Apple credential acquisition', () => {
  let nonceSeed = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.providerIds.length = 0;
    nonceSeed = 0;
    mocks.random.mockImplementation((array: Uint8Array) => {
      nonceSeed += 1;
      array.fill(nonceSeed);
      return array;
    });
    mocks.digest.mockImplementation(async (_algorithm, rawNonce: string) => {
      return `hash:${rawNonce}`;
    });
    mocks.signIn.mockResolvedValue({
      identityToken: 'apple-id-token',
      fullName: null,
    });
    mocks.oauthCredential.mockImplementation((input) => ({ input }));
  });

  it('creates a fresh nonce for every reauthentication attempt', async () => {
    await getAppleCredential({ requestProfile: false });
    await getAppleCredential({ requestProfile: false });

    const firstRawNonce = mocks.digest.mock.calls[0][1];
    const secondRawNonce = mocks.digest.mock.calls[1][1];
    expect(firstRawNonce).not.toBe(secondRawNonce);
    expect(mocks.signIn).toHaveBeenNthCalledWith(1, {
      requestedScopes: [],
      nonce: `hash:${firstRawNonce}`,
    });
    expect(mocks.signIn).toHaveBeenNthCalledWith(2, {
      requestedScopes: [],
      nonce: `hash:${secondRawNonce}`,
    });
    expect(mocks.oauthCredential).toHaveBeenNthCalledWith(1, {
      idToken: 'apple-id-token',
      rawNonce: firstRawNonce,
    });
    expect(mocks.oauthCredential).toHaveBeenNthCalledWith(2, {
      idToken: 'apple-id-token',
      rawNonce: secondRawNonce,
    });
    expect(mocks.providerIds).toEqual(['apple.com', 'apple.com']);
  });

  it('preserves profile scopes for login but never depends on profile during reauth', async () => {
    mocks.signIn.mockResolvedValue({
      identityToken: 'apple-id-token',
      fullName: { givenName: 'Apple', familyName: 'Person' },
    });

    await expect(getAppleCredential()).resolves.toMatchObject({
      displayName: 'Apple Person',
    });
    await expect(
      getAppleCredential({ requestProfile: false }),
    ).resolves.toMatchObject({ displayName: null });
    expect(mocks.signIn.mock.calls[0][0].requestedScopes).toEqual([0, 1]);
    expect(mocks.signIn.mock.calls[1][0].requestedScopes).toEqual([]);
  });

  it('treats cancellation and a missing identity token explicitly', async () => {
    mocks.signIn.mockRejectedValueOnce({ code: 'ERR_REQUEST_CANCELED' });
    await expect(getAppleCredential({ requestProfile: false })).rejects.toBeInstanceOf(
      SocialAuthCancelledError,
    );

    mocks.signIn.mockResolvedValueOnce({ identityToken: null, fullName: null });
    await expect(getAppleCredential({ requestProfile: false })).rejects.toEqual(
      new ProviderCredentialError('identityTokenMissing'),
    );
    expect(mocks.oauthCredential).not.toHaveBeenCalled();
  });
});
