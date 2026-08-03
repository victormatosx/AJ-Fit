import { describe, expect, it } from 'vitest';
import { versionedPhotoURL } from '../profilePhotoUrl';

describe('versionedPhotoURL', () => {
  it('appends a cache version to a Firebase download URL', () => {
    expect(versionedPhotoURL('https://example.test/avatar?alt=media', 123)).toBe(
      'https://example.test/avatar?alt=media&v=123',
    );
  });

  it('supports Firestore Timestamp-like versions', () => {
    expect(
      versionedPhotoURL('https://example.test/avatar', { toMillis: () => 456 }),
    ).toBe('https://example.test/avatar?v=456');
  });

  it('does not alter a local preview URI', () => {
    expect(versionedPhotoURL('file:///avatar.jpg', 123)).toBe('file:///avatar.jpg');
  });

  it('keeps the exact same URL after a name-only change', () => {
    const before = {
      name: 'Ana',
      photoURL: 'https://example.test/avatar?alt=media&g=7',
      photoVersion: { toMillis: () => 123 },
    };
    const after = { ...before, name: 'Ana Silva' };

    expect(versionedPhotoURL(after.photoURL, after.photoVersion)).toBe(
      versionedPhotoURL(before.photoURL, before.photoVersion),
    );
  });

  it('keeps the exact same URL after a birth-date-only change', () => {
    const before = {
      birthDate: '1990-01-01',
      photoURL: 'https://example.test/avatar?alt=media&g=7',
      photoVersion: { toMillis: () => 123 },
    };
    const after = { ...before, birthDate: '1991-02-02' };

    expect(versionedPhotoURL(after.photoURL, after.photoVersion)).toBe(
      versionedPhotoURL(before.photoURL, before.photoVersion),
    );
  });

  it('creates a new URL when a new photo generation and version are stored', () => {
    const before = versionedPhotoURL('https://example.test/avatar?alt=media&g=7', 123);
    const after = versionedPhotoURL('https://example.test/avatar?alt=media&g=8', 456);

    expect(after).not.toBe(before);
  });
});
