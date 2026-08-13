import { beforeEach, describe, expect, it } from 'vitest';

import {
  closePhotoVaultSession,
  isPhotoVaultUnlockedFor,
  openPhotoVaultSession,
  photoVaultSessionUid,
  requirePhotoVaultUnlocked,
} from '../photoVaultSession';

const UID = 'alice';
const OTHER_UID = 'mallory';

beforeEach(() => {
  closePhotoVaultSession();
});

describe('session lifecycle', () => {
  it('starts closed', () => {
    expect(photoVaultSessionUid()).toBeNull();
    expect(isPhotoVaultUnlockedFor(UID)).toBe(false);
  });

  it('opens for a uid and closes again', () => {
    openPhotoVaultSession(UID);
    expect(isPhotoVaultUnlockedFor(UID)).toBe(true);

    closePhotoVaultSession();
    expect(isPhotoVaultUnlockedFor(UID)).toBe(false);
  });

  it('tolerates closing when already closed', () => {
    expect(() => closePhotoVaultSession()).not.toThrow();
  });

  it('refuses to open without a uid', () => {
    expect(() => openPhotoVaultSession('')).toThrowError(
      expect.objectContaining({ issue: 'vaultUnlockFailed' }),
    );
  });
});

describe('requirePhotoVaultUnlocked', () => {
  it('passes for the uid that authenticated', () => {
    openPhotoVaultSession(UID);

    expect(() => requirePhotoVaultUnlocked(UID)).not.toThrow();
  });

  it('throws when nothing is unlocked', () => {
    expect(() => requirePhotoVaultUnlocked(UID)).toThrowError(
      expect.objectContaining({ issue: 'vaultLocked' }),
    );
  });

  it('throws for a different uid', () => {
    openPhotoVaultSession(UID);

    expect(() => requirePhotoVaultUnlocked(OTHER_UID)).toThrowError(
      expect.objectContaining({ issue: 'vaultLocked' }),
    );
  });

  it('destroys a stale session the moment a mismatch is detected', () => {
    openPhotoVaultSession(UID);

    expect(() => requirePhotoVaultUnlocked(OTHER_UID)).toThrow();

    // The original owner loses the grant too: reaching here means an account
    // change slipped past, and that grant must not survive the discovery.
    expect(photoVaultSessionUid()).toBeNull();
    expect(() => requirePhotoVaultUnlocked(UID)).toThrow();
  });
});

describe('cross-user isolation', () => {
  it('never reports user B as unlocked because A is', () => {
    openPhotoVaultSession(UID);

    expect(isPhotoVaultUnlockedFor(OTHER_UID)).toBe(false);
  });

  it.each([null, undefined, ''])('never reports %s as unlocked', (uid) => {
    openPhotoVaultSession(UID);

    expect(isPhotoVaultUnlockedFor(uid)).toBe(false);
  });
});

describe('never persisted', () => {
  it('keeps the session in memory only', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultSession.ts', 'utf8');

    // A persisted unlock would survive a restart, defeating the lock.
    expect(source).not.toContain('AsyncStorage');
    expect(source).not.toContain('SecureStore');
    expect(source).not.toContain('expo-file-system');
    expect(source).not.toContain('firebase');
  });

  it('exposes no writable unlocked flag', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultSession.ts', 'utf8');

    // The module never hands out a mutable boolean another service could set.
    expect(source).not.toMatch(/export\s+let\b/);
    expect(source).not.toMatch(/export\s+(const|function)\s+setUnlocked/);
  });
});
