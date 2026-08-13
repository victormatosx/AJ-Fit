import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  cleanup: vi.fn(),
  activateScreenProtection: vi.fn(),
}));

vi.mock('../../services/localAuthentication', () => ({
  authenticateForPhotoVault: mocks.authenticate,
}));

vi.mock('../../services/photoVaultFileCrypto', () => ({
  cleanupPhotoVaultTempFiles: mocks.cleanup,
}));

vi.mock('../../services/photoVaultScreenProtection', () => ({
  activatePhotoVaultScreenProtection: mocks.activateScreenProtection,
}));

import {
  getPhotoVaultStatus,
  handlePhotoVaultAppStateChange,
  lockPhotoVault,
  resetPhotoVaultLockForTesting,
  subscribeToPhotoVaultStatus,
  unlockPhotoVault,
} from '../photoVaultLock';
import { PhotoVaultError } from '../photoVaultErrors';
import {
  isPhotoVaultUnlockedFor,
  photoVaultSessionUid,
  requirePhotoVaultUnlocked,
} from '../photoVaultSession';

const UID = 'alice';
const OTHER_UID = 'mallory';

/** Records every status the machine passes through. */
function trackTransitions(): string[] {
  const seen: string[] = [];
  subscribeToPhotoVaultStatus((s) => seen.push(s));
  return seen;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPhotoVaultLockForTesting();
  mocks.authenticate.mockResolvedValue({ status: 'success' });
  mocks.cleanup.mockImplementation(() => undefined);
  mocks.activateScreenProtection.mockResolvedValue(undefined);
});

// ── Initial state ──────────────────────────────────────────────────────────

describe('initial state', () => {
  it('starts locked', () => {
    expect(getPhotoVaultStatus()).toBe('locked');
    expect(photoVaultSessionUid()).toBeNull();
  });

  it('does not unlock just because a user is signed in', async () => {
    // No authentication has happened, so nothing is open.
    expect(isPhotoVaultUnlockedFor(UID)).toBe(false);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });
});

// ── State machine ──────────────────────────────────────────────────────────

describe('state machine', () => {
  it('allows the Vault-owned Face ID inactive transition to finish safely', async () => {
    let release: (value: unknown) => void = () => undefined;
    mocks.authenticate.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const outcomePromise = unlockPhotoVault(UID);
    expect(getPhotoVaultStatus()).toBe('authenticating');

    expect(handlePhotoVaultAppStateChange('active', 'inactive')).toEqual({
      locked: false,
    });
    expect(getPhotoVaultStatus()).toBe('authenticating');

    release({ status: 'success' });
    await Promise.resolve();

    // Native success cannot expose content while the app is still inactive.
    expect(getPhotoVaultStatus()).toBe('authenticating');
    handlePhotoVaultAppStateChange('inactive', 'active');

    expect(await outcomePromise).toEqual({ ok: true });
    expect(getPhotoVaultStatus()).toBe('unlocked');
  });

  it('locks an unlocked vault immediately on inactive', async () => {
    await unlockPhotoVault(UID);

    expect(handlePhotoVaultAppStateChange('active', 'inactive')).toEqual({
      locked: true,
    });

    expect(getPhotoVaultStatus()).toBe('locked');
    expect(isPhotoVaultUnlockedFor(UID)).toBe(false);
  });

  it('cancels safely when an authenticating app reaches real background', async () => {
    let release: (value: unknown) => void = () => undefined;
    mocks.authenticate.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const outcomePromise = unlockPhotoVault(UID);
    handlePhotoVaultAppStateChange('active', 'inactive');

    expect(handlePhotoVaultAppStateChange('inactive', 'background')).toEqual({
      locked: true,
    });
    expect(getPhotoVaultStatus()).toBe('locked');

    release({ status: 'success' });

    expect(await outcomePromise).toEqual({ ok: false, issue: 'vaultAuthCancelled' });
    expect(isPhotoVaultUnlockedFor(UID)).toBe(false);
    expect(mocks.activateScreenProtection).not.toHaveBeenCalled();
  });

  it('locked → authenticating → unlocked on success', async () => {
    const seen = trackTransitions();

    const outcome = await unlockPhotoVault(UID);

    expect(outcome).toEqual({ ok: true });
    expect(seen).toEqual(['authenticating', 'unlocked']);
    expect(getPhotoVaultStatus()).toBe('unlocked');
    expect(isPhotoVaultUnlockedFor(UID)).toBe(true);
    expect(mocks.activateScreenProtection).toHaveBeenCalledTimes(1);
  });

  it('fails closed when native screen protection cannot be enabled', async () => {
    mocks.activateScreenProtection.mockRejectedValue(
      new PhotoVaultError('vaultScreenProtectionFailed'),
    );

    const outcome = await unlockPhotoVault(UID);

    expect(outcome).toEqual({ ok: false, issue: 'vaultScreenProtectionFailed' });
    expect(getPhotoVaultStatus()).toBe('locked');
    expect(isPhotoVaultUnlockedFor(UID)).toBe(false);
  });

  it('locked → authenticating → locked on cancellation', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.authenticate.mockResolvedValue({ status: 'cancelled' });
    const seen = trackTransitions();

    try {
      const outcome = await unlockPhotoVault(UID);

      expect(outcome).toEqual({ ok: false, issue: 'vaultAuthCancelled' });
      expect(seen).toEqual(['authenticating', 'locked']);
      expect(isPhotoVaultUnlockedFor(UID)).toBe(false);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('locked → authenticating → locked on failure', async () => {
    mocks.authenticate.mockResolvedValue({ status: 'failed' });
    const seen = trackTransitions();

    const outcome = await unlockPhotoVault(UID);

    expect(outcome).toEqual({ ok: false, issue: 'vaultAuthFailed' });
    expect(seen).toEqual(['authenticating', 'locked']);
  });

  it('unlocked → locked on an explicit lock', async () => {
    await unlockPhotoVault(UID);
    const seen = trackTransitions();

    lockPhotoVault();

    expect(seen).toEqual(['locked']);
    expect(getPhotoVaultStatus()).toBe('locked');
  });

  it('never gets stuck in authenticating', async () => {
    mocks.authenticate.mockRejectedValue(new Error('module blew up'));

    const outcome = await unlockPhotoVault(UID);

    expect(outcome).toEqual({ ok: false, issue: 'vaultUnlockFailed' });
    expect(getPhotoVaultStatus()).toBe('locked');
  });

  it.each([
    ['cancelled', 'vaultAuthCancelled'],
    ['lockedOut', 'vaultAuthLockedOut'],
    ['notAvailable', 'vaultAuthUnavailable'],
    ['notEnrolled', 'vaultAuthNotEnrolled'],
    ['notConfigured', 'vaultAuthNotConfigured'],
    ['failed', 'vaultAuthFailed'],
  ])('maps %s onto %s and stays locked', async (status, issue) => {
    mocks.authenticate.mockResolvedValue({ status });

    expect(await unlockPhotoVault(UID)).toEqual({ ok: false, issue });
    expect(getPhotoVaultStatus()).toBe('locked');
  });

  it('refuses to unlock without a signed-in user', async () => {
    expect(await unlockPhotoVault(null)).toEqual({
      ok: false,
      issue: 'vaultKeyNotAvailable',
    });
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });
});

// ── Concurrency ────────────────────────────────────────────────────────────

describe('double prompt prevention', () => {
  it('opens only one native prompt for concurrent calls', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.authenticate.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const first = unlockPhotoVault(UID);
    const second = unlockPhotoVault(UID);

    release({ status: 'success' });
    const [a, b] = await Promise.all([first, second]);

    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ ok: true });
    // The second caller shares the in-flight attempt rather than failing.
    expect(b).toEqual({ ok: true });
    expect(getPhotoVaultStatus()).toBe('unlocked');
  });

  it('shares the outcome of a failed concurrent attempt', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.authenticate.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const first = unlockPhotoVault(UID);
    const second = unlockPhotoVault(UID);

    release({ status: 'cancelled' });
    const [a, b] = await Promise.all([first, second]);

    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(getPhotoVaultStatus()).toBe('locked');
  });

  it('allows a new attempt once the previous one settles', async () => {
    mocks.authenticate.mockResolvedValue({ status: 'cancelled' });
    await unlockPhotoVault(UID);

    mocks.authenticate.mockResolvedValue({ status: 'success' });
    expect(await unlockPhotoVault(UID)).toEqual({ ok: true });
    expect(mocks.authenticate).toHaveBeenCalledTimes(2);
  });
});

// ── Locking and cleanup ────────────────────────────────────────────────────

describe('lock cleanup', () => {
  it('removes temporary plaintext when locking', async () => {
    await unlockPhotoVault(UID);
    const cleanupCallsBeforeLock = mocks.cleanup.mock.calls.length;

    lockPhotoVault();

    expect(mocks.cleanup).toHaveBeenCalledTimes(cleanupCallsBeforeLock + 1);
  });

  it('stays locked even when cleanup fails', async () => {
    await unlockPhotoVault(UID);
    mocks.cleanup.mockImplementation(() => {
      throw new Error('filesystem busy');
    });

    expect(() => lockPhotoVault()).not.toThrow();

    // Security first: a failed cleanup never returns the vault to unlocked.
    expect(getPhotoVaultStatus()).toBe('locked');
    expect(isPhotoVaultUnlockedFor(UID)).toBe(false);
  });

  it('closes the session before cleaning up', async () => {
    await unlockPhotoVault(UID);
    let unlockedDuringCleanup = true;
    mocks.cleanup.mockImplementation(() => {
      unlockedDuringCleanup = isPhotoVaultUnlockedFor(UID);
    });

    lockPhotoVault();

    expect(unlockedDuringCleanup).toBe(false);
  });

  it('is idempotent', () => {
    expect(() => {
      lockPhotoVault();
      lockPhotoVault();
    }).not.toThrow();
  });

  it('blocks the service gate immediately after locking', async () => {
    await unlockPhotoVault(UID);
    expect(() => requirePhotoVaultUnlocked(UID)).not.toThrow();

    lockPhotoVault();

    expect(() => requirePhotoVaultUnlocked(UID)).toThrowError(
      expect.objectContaining({ issue: 'vaultLocked' }),
    );
  });
});

// ── Cross-user ─────────────────────────────────────────────────────────────

describe('cross-user isolation', () => {
  it('grants the session only to the uid that authenticated', async () => {
    await unlockPhotoVault(UID);

    expect(isPhotoVaultUnlockedFor(UID)).toBe(true);
    expect(isPhotoVaultUnlockedFor(OTHER_UID)).toBe(false);
  });

  it("never lets a new user inherit the previous user's unlock", async () => {
    await unlockPhotoVault(UID);

    // What the provider does on an identity change.
    lockPhotoVault();

    expect(isPhotoVaultUnlockedFor(OTHER_UID)).toBe(false);
    expect(() => requirePhotoVaultUnlocked(OTHER_UID)).toThrow();
  });
});

// ── Never persisted ────────────────────────────────────────────────────────

describe('never persisted', () => {
  it('keeps the lock state in memory only', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultLock.ts', 'utf8');

    expect(source).not.toContain('AsyncStorage');
    expect(source).not.toContain('SecureStore');
    expect(source).not.toContain('firebase');
  });

  it('does not depend on React', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultLock.ts', 'utf8');

    // The lock belongs to the app, not to a component subtree.
    expect(source).not.toMatch(/from 'react'/);
  });
});
