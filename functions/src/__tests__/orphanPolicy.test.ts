import { describe, expect, it } from 'vitest';

import {
  documentClaimsAsset,
  isConfirmedCandidate,
  isOldEnough,
  ORPHAN_CONFIRMATION_MS,
  ORPHAN_MIN_AGE_MS,
  parsePhotoObjectPath,
} from '../photoVault/orphanPolicy';

const NOW = Date.UTC(2026, 7, 12);
const PHOTO_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_ID = '123e4567-e89b-42d3-a456-426614174001';

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

  it('keeps object names opaque regardless of how the document is named', () => {
    // Phase 14 changes document ids, never Storage object ids. A dated object
    // name must stay unparseable so nothing starts writing them.
    expect(
      parsePhotoObjectPath('users/alice/progressPhotos/2026-08-15_front.enc'),
    ).toBeNull();
  });
});

describe('document ownership of an asset', () => {
  it('accepts a pre-pose document named after its asset', () => {
    expect(
      documentClaimsAsset({
        documentId: PHOTO_ID,
        assetId: undefined,
        assetIdFromPath: PHOTO_ID,
      }),
    ).toBe(true);
  });

  it('accepts a posed document that references the asset by field', () => {
    expect(
      documentClaimsAsset({
        documentId: '2026-08-15_front',
        assetId: PHOTO_ID,
        assetIdFromPath: PHOTO_ID,
      }),
    ).toBe(true);
  });

  it('rejects a posed document pointing at a different asset', () => {
    expect(
      documentClaimsAsset({
        documentId: '2026-08-15_front',
        assetId: OTHER_ID,
        assetIdFromPath: PHOTO_ID,
      }),
    ).toBe(false);
  });

  it('rejects an unrelated document id with no assetId', () => {
    expect(
      documentClaimsAsset({
        documentId: '2026-08-15_front',
        assetId: undefined,
        assetIdFromPath: PHOTO_ID,
      }),
    ).toBe(false);
  });

  it('falls back to the document id when assetId is not a string', () => {
    // A malformed field must not make a legacy document unrecognizable —
    // failing to recognize it would eventually delete live ciphertext.
    expect(
      documentClaimsAsset({
        documentId: PHOTO_ID,
        assetId: 42,
        assetIdFromPath: PHOTO_ID,
      }),
    ).toBe(true);
  });
});
