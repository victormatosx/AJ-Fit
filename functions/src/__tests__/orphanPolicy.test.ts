import { describe, expect, it } from 'vitest';

import {
  isConfirmedCandidate,
  isOldEnough,
  ORPHAN_CONFIRMATION_MS,
  ORPHAN_MIN_AGE_MS,
  parsePhotoObjectPath,
} from '../photoVault/orphanPolicy';

const NOW = Date.UTC(2026, 7, 12);
const PHOTO_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('Photo Vault orphan policy', () => {
  it('recognizes only the canonical ciphertext path', () => {
    expect(
      parsePhotoObjectPath(`users/alice/progressPhotos/${PHOTO_ID}.enc`),
    ).toEqual({ uid: 'alice', photoId: PHOTO_ID, assetKind: 'full' });
    expect(
      parsePhotoObjectPath(`users/alice/progressPhotos/${PHOTO_ID}.thumb.enc`),
    ).toEqual({ uid: 'alice', photoId: PHOTO_ID, assetKind: 'thumbnail' });
    expect(parsePhotoObjectPath(`users/alice/progressPhotos/${PHOTO_ID}.jpg`)).toBeNull();
    expect(parsePhotoObjectPath('users/alice/avatar.enc')).toBeNull();
    expect(parsePhotoObjectPath('support/ticket.enc')).toBeNull();
  });

  it('preserves a recent object without metadata', () => {
    expect(isOldEnough(NOW - ORPHAN_MIN_AGE_MS + 1, NOW)).toBe(false);
  });

  it('allows an old object to become a candidate', () => {
    expect(isOldEnough(NOW - ORPHAN_MIN_AGE_MS, NOW)).toBe(true);
  });

  it('requires a second observation after the confirmation window', () => {
    expect(isConfirmedCandidate(NOW - ORPHAN_CONFIRMATION_MS + 1, NOW)).toBe(false);
    expect(isConfirmedCandidate(NOW - ORPHAN_CONFIRMATION_MS, NOW)).toBe(true);
  });

  it('rejects missing or invalid timestamps instead of deleting', () => {
    expect(isOldEnough(Number.NaN, NOW)).toBe(false);
    expect(isOldEnough(0, NOW)).toBe(false);
    expect(isConfirmedCandidate(Number.POSITIVE_INFINITY, NOW)).toBe(false);
  });
});
