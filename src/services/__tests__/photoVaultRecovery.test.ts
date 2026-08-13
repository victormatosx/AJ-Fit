import { beforeEach, describe, expect, it, vi } from 'vitest';

// Declared inside vi.hoisted so the mock factory (hoisted to the top of the
// file) can reference them. These mirror the real error classes from
// services/reauthentication.
const mocks = vi.hoisted(() => {
  class ReauthenticationCancelledError extends Error {
    constructor() {
      super('Reauthentication cancelled');
      this.name = 'ReauthenticationCancelledError';
    }
  }

  class ReauthenticationServiceError extends Error {
    readonly issue: string;

    constructor(issue: string) {
      super(issue);
      this.name = 'ReauthenticationServiceError';
      this.issue = issue;
    }
  }

  return {
    reauthenticate: vi.fn(),
    recover: vi.fn(),
    getIdToken: vi.fn(),
    ReauthenticationCancelledError,
    ReauthenticationServiceError,
  };
});

const { ReauthenticationCancelledError, ReauthenticationServiceError } = mocks;

vi.mock('../reauthentication', () => ({
  reauthenticateCurrentUser: mocks.reauthenticate,
  ReauthenticationCancelledError: mocks.ReauthenticationCancelledError,
  ReauthenticationServiceError: mocks.ReauthenticationServiceError,
}));

vi.mock('../photoVault', () => ({ recoverPhotoVaultKey: mocks.recover }));

vi.mock('../../lib/firebase', () => ({
  auth: {
    get currentUser() {
      return { uid: 'alice', getIdToken: mocks.getIdToken };
    },
  },
}));

import { PhotoVaultError } from '../../lib/photoVaultErrors';
import { reauthenticateAndRecoverVaultKey } from '../photoVaultRecovery';

const VALID_KEY = 'A'.repeat(43) + '=';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reauthenticate.mockResolvedValue({ uid: 'alice' });
  mocks.getIdToken.mockResolvedValue('fresh-token');
  mocks.recover.mockResolvedValue({ vaultKey: VALID_KEY, vaultKeyVersion: 1 });
});

// ── Providers ──────────────────────────────────────────────────────────────

describe('supported providers', () => {
  it('recovers after a password reauthentication', async () => {
    const result = await reauthenticateAndRecoverVaultKey({
      provider: 'password',
      password: 'correct horse battery staple',
    });

    expect(result).toEqual({ vaultKey: VALID_KEY, vaultKeyVersion: 1 });
    expect(mocks.reauthenticate).toHaveBeenCalledWith({
      provider: 'password',
      password: 'correct horse battery staple',
    });
  });

  it('recovers after a Google reauthentication', async () => {
    await expect(
      reauthenticateAndRecoverVaultKey({ provider: 'google' }),
    ).resolves.toBeDefined();

    expect(mocks.reauthenticate).toHaveBeenCalledWith({ provider: 'google' });
  });

  it('recovers after an Apple reauthentication', async () => {
    await expect(
      reauthenticateAndRecoverVaultKey({ provider: 'apple' }),
    ).resolves.toBeDefined();

    expect(mocks.reauthenticate).toHaveBeenCalledWith({ provider: 'apple' });
  });

  it('delegates to the existing reauthentication service, not a parallel login', async () => {
    await reauthenticateAndRecoverVaultKey({ provider: 'google' });

    expect(mocks.reauthenticate).toHaveBeenCalledTimes(1);
  });
});

// ── Token refresh ──────────────────────────────────────────────────────────

describe('token freshness', () => {
  it('forces a token refresh before recovering', async () => {
    await reauthenticateAndRecoverVaultKey({ provider: 'google' });

    // Without `true` the SDK may return the cached pre-reauth token, whose
    // auth_time the backend would reject.
    expect(mocks.getIdToken).toHaveBeenCalledWith(true);
  });

  it('refreshes the token after reauthenticating, before recovering', async () => {
    await reauthenticateAndRecoverVaultKey({ provider: 'google' });

    expect(mocks.reauthenticate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getIdToken.mock.invocationCallOrder[0]!,
    );
    expect(mocks.getIdToken.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recover.mock.invocationCallOrder[0]!,
    );
  });

  it('does not recover when the refresh fails', async () => {
    mocks.getIdToken.mockRejectedValue(new Error('network'));

    await expect(
      reauthenticateAndRecoverVaultKey({ provider: 'google' }),
    ).rejects.toThrowError(expect.objectContaining({ issue: 'vaultReauthRequired' }));

    expect(mocks.recover).not.toHaveBeenCalled();
  });
});

// ── Failures ───────────────────────────────────────────────────────────────

describe('reauthentication failures', () => {
  it('treats cancellation as still needing reauthentication', async () => {
    mocks.reauthenticate.mockRejectedValue(new ReauthenticationCancelledError());

    await expect(
      reauthenticateAndRecoverVaultKey({ provider: 'apple' }),
    ).rejects.toThrowError(expect.objectContaining({ issue: 'vaultReauthRequired' }));

    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it('maps an unsupported provider onto a reauth requirement', async () => {
    mocks.reauthenticate.mockRejectedValue(
      new ReauthenticationServiceError('reauthProviderUnsupported'),
    );

    await expect(
      reauthenticateAndRecoverVaultKey({ provider: 'google' }),
    ).rejects.toThrowError(expect.objectContaining({ issue: 'vaultReauthRequired' }));
  });

  it('maps a failed reauthentication onto a reauth requirement', async () => {
    mocks.reauthenticate.mockRejectedValue(new ReauthenticationServiceError('reauthFailed'));

    await expect(
      reauthenticateAndRecoverVaultKey({ provider: 'password', password: 'wrong' }),
    ).rejects.toThrowError(expect.objectContaining({ issue: 'vaultReauthRequired' }));

    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it('never leaks the password into the error', async () => {
    mocks.reauthenticate.mockRejectedValue(new Error('wrong password: hunter2'));

    const error = await reauthenticateAndRecoverVaultKey({
      provider: 'password',
      password: 'hunter2',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PhotoVaultError);
    expect((error as Error).message).not.toContain('hunter2');
  });
});

// ── Recovery failures ──────────────────────────────────────────────────────

describe('recovery failures', () => {
  it('preserves a controlled vault issue', async () => {
    mocks.recover.mockRejectedValue(new PhotoVaultError('vaultKeyNotAvailable'));

    await expect(
      reauthenticateAndRecoverVaultKey({ provider: 'google' }),
    ).rejects.toThrowError(expect.objectContaining({ issue: 'vaultKeyNotAvailable' }));
  });

  it('flattens an unexpected failure', async () => {
    mocks.recover.mockRejectedValue(new Error('boom'));

    await expect(
      reauthenticateAndRecoverVaultKey({ provider: 'google' }),
    ).rejects.toThrowError(expect.objectContaining({ issue: 'vaultRecoveryFailed' }));
  });

  it('never retries recovery automatically', async () => {
    mocks.recover.mockRejectedValue(new PhotoVaultError('vaultReauthRequired'));

    await reauthenticateAndRecoverVaultKey({ provider: 'google' }).catch(() => undefined);

    expect(mocks.recover).toHaveBeenCalledTimes(1);
    expect(mocks.reauthenticate).toHaveBeenCalledTimes(1);
  });
});
