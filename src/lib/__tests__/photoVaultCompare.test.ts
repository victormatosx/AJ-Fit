import { describe, expect, it } from 'vitest';

import {
  COMPARISON_GROUPS,
  canCompareProgressPhotos,
  comparisonCandidatesFor,
  comparisonGroupOf,
  comparisonStartCandidates,
  isComparable,
  normalizeBeforeAfter,
} from '../photoVaultCompare';
import type { GalleryPhoto } from '../photoVaultGallery';
import type { ProgressPhotoPose } from '../photoVaultIdentity';

/**
 * Builds a gallery entry. Only the fields the pairing rules read are
 * meaningful; the rest mirror the controller's own defaults.
 */
function photo(params: {
  photoId: string;
  takenAt: Date;
  pose?: ProgressPhotoPose;
  /** Simulates an optimistic upload: no remote metadata yet. */
  uploading?: boolean;
}): GalleryPhoto {
  return {
    photoId: params.photoId,
    assetId: params.uploading ? null : `asset-${params.photoId}`,
    ...(params.pose ? { pose: params.pose, dateKey: '2026-08-15' } : {}),
    takenAt: params.takenAt,
    metadata: params.uploading ? null : ({} as GalleryPhoto['metadata']),
    thumbnailUri: null,
    fullUri: null,
    previewUri: null,
    thumbnailLoading: false,
    fullLoading: false,
    failed: false,
    uploadStatus: params.uploading ? 'uploading' : null,
    uploadProgress: null,
  };
}

/** A posed photo on a given day. */
function posed(id: string, pose: ProgressPhotoPose, day: number): GalleryPhoto {
  return photo({ photoId: id, pose, takenAt: new Date(2026, 7, day, 12, 0) });
}

/** A photo recorded before poses existed. */
function legacy(id: string, day: number, hour = 12): GalleryPhoto {
  return photo({ photoId: id, takenAt: new Date(2026, 7, day, hour, 0) });
}

describe('comparison groups', () => {
  it('buckets a posed photo by its pose', () => {
    expect(comparisonGroupOf(posed('a', 'front', 1))).toBe('front');
    expect(comparisonGroupOf(posed('b', 'side', 1))).toBe('side');
    expect(comparisonGroupOf(posed('c', 'back', 1))).toBe('back');
  });

  it('buckets every pre-pose photo together as unclassified', () => {
    // One bucket for "unknown" — never a fourth pose.
    expect(comparisonGroupOf(legacy('old-a', 1))).toBe('unclassified');
    expect(comparisonGroupOf(legacy('old-b', 2))).toBe('unclassified');
  });

  it('exposes the poses in the gallery order, then unclassified', () => {
    expect([...COMPARISON_GROUPS]).toEqual(['front', 'side', 'back', 'unclassified']);
  });
});

describe('isComparable', () => {
  it('accepts a photo with remote metadata', () => {
    expect(isComparable(posed('a', 'front', 1))).toBe(true);
  });

  it('rejects an upload still in flight', () => {
    // Its ciphertext does not exist remotely yet, so a later composition
    // phase could not read it.
    const optimistic = photo({
      photoId: 'local-upload-1',
      pose: 'front',
      takenAt: new Date(2026, 7, 1, 12, 0),
      uploading: true,
    });
    expect(isComparable(optimistic)).toBe(false);
  });
});

describe('canCompareProgressPhotos', () => {
  it('is false for an empty gallery', () => {
    expect(canCompareProgressPhotos([])).toBe(false);
  });

  it('is false for a single front photo', () => {
    expect(canCompareProgressPhotos([posed('a', 'front', 1)])).toBe(false);
  });

  it('is true for two front photos', () => {
    expect(
      canCompareProgressPhotos([posed('a', 'front', 1), posed('b', 'front', 2)]),
    ).toBe(true);
  });

  it('is false for one front and one side', () => {
    // Two photos, zero valid pairs — the reason `length >= 2` is not enough.
    expect(
      canCompareProgressPhotos([posed('a', 'front', 1), posed('b', 'side', 2)]),
    ).toBe(false);
  });

  it('is true for two side photos', () => {
    expect(
      canCompareProgressPhotos([posed('a', 'side', 1), posed('b', 'side', 2)]),
    ).toBe(true);
  });

  it('is true for two back photos', () => {
    expect(
      canCompareProgressPhotos([posed('a', 'back', 1), posed('b', 'back', 2)]),
    ).toBe(true);
  });

  it('is true for two pre-pose photos', () => {
    expect(canCompareProgressPhotos([legacy('old-a', 1), legacy('old-b', 2)])).toBe(true);
  });

  it('is false for one pre-pose photo and one front', () => {
    expect(canCompareProgressPhotos([legacy('old-a', 1), posed('b', 'front', 2)])).toBe(
      false,
    );
  });

  it('is false for three mixed photos with no matching pair', () => {
    expect(
      canCompareProgressPhotos([
        posed('a', 'front', 1),
        posed('b', 'side', 2),
        posed('c', 'back', 3),
      ]),
    ).toBe(false);
  });

  it('is true as soon as one group reaches two, whatever else exists', () => {
    expect(
      canCompareProgressPhotos([
        posed('a', 'front', 1),
        posed('b', 'side', 2),
        posed('c', 'front', 3),
      ]),
    ).toBe(true);
  });

  it('does not count an in-flight upload toward a pair', () => {
    const optimistic = photo({
      photoId: 'local-upload-1',
      pose: 'front',
      takenAt: new Date(2026, 7, 5, 12, 0),
      uploading: true,
    });
    expect(canCompareProgressPhotos([posed('a', 'front', 1), optimistic])).toBe(false);
  });
});

describe('comparisonStartCandidates', () => {
  it('omits a photo that has no partner in its own group', () => {
    const candidates = comparisonStartCandidates([
      posed('a', 'front', 1),
      posed('b', 'front', 2),
      posed('lonely', 'side', 3),
    ]);

    // Offering `lonely` would lead straight to an empty second step.
    expect(candidates.map((p) => p.photoId).sort()).toEqual(['a', 'b']);
  });

  it('omits in-flight uploads', () => {
    const optimistic = photo({
      photoId: 'local-upload-1',
      pose: 'front',
      takenAt: new Date(2026, 7, 5, 12, 0),
      uploading: true,
    });
    const candidates = comparisonStartCandidates([
      posed('a', 'front', 1),
      posed('b', 'front', 2),
      optimistic,
    ]);

    expect(candidates.map((p) => p.photoId)).not.toContain('local-upload-1');
  });

  it('is empty when nothing can be compared', () => {
    expect(comparisonStartCandidates([posed('a', 'front', 1)])).toEqual([]);
  });
});

describe('comparisonCandidatesFor', () => {
  const gallery = [
    posed('front-1', 'front', 1),
    posed('front-2', 'front', 2),
    posed('side-1', 'side', 3),
    posed('side-2', 'side', 4),
    posed('back-1', 'back', 5),
    posed('back-2', 'back', 6),
    legacy('old-1', 7),
    legacy('old-2', 8),
  ];

  it('offers only other front photos for a front selection', () => {
    const candidates = comparisonCandidatesFor(gallery[0]!, gallery);
    expect(candidates.map((p) => p.photoId)).toEqual(['front-2']);
  });

  it('offers only other side photos for a side selection', () => {
    const candidates = comparisonCandidatesFor(gallery[2]!, gallery);
    expect(candidates.map((p) => p.photoId)).toEqual(['side-2']);
  });

  it('offers only other back photos for a back selection', () => {
    const candidates = comparisonCandidatesFor(gallery[4]!, gallery);
    expect(candidates.map((p) => p.photoId)).toEqual(['back-2']);
  });

  it('offers only other pre-pose photos for a pre-pose selection', () => {
    const candidates = comparisonCandidatesFor(gallery[6]!, gallery);
    expect(candidates.map((p) => p.photoId)).toEqual(['old-2']);
  });

  it('never offers the selected photo itself', () => {
    for (const selected of gallery) {
      const candidates = comparisonCandidatesFor(selected, gallery);
      expect(candidates.map((p) => p.photoId)).not.toContain(selected.photoId);
    }
  });

  it('never mixes a pre-pose photo with a posed one', () => {
    const fromLegacy = comparisonCandidatesFor(gallery[6]!, gallery);
    expect(fromLegacy.every((p) => p.pose === undefined)).toBe(true);

    const fromPosed = comparisonCandidatesFor(gallery[0]!, gallery);
    expect(fromPosed.every((p) => p.pose === 'front')).toBe(true);
  });

  it('excludes a photo taken at the exact same instant', () => {
    const at = new Date(2026, 7, 10, 9, 30);
    const a = photo({ photoId: 'a', takenAt: at });
    const b = photo({ photoId: 'b', takenAt: new Date(at.getTime()) });

    // Same moment shows no progress and has no before/after ordering.
    expect(comparisonCandidatesFor(a, [a, b])).toEqual([]);
  });

  it('keeps two pre-pose photos from the same day but different times', () => {
    // Only pre-pose photos can share a day: the posed model allows one photo
    // per (day, pose), so two posed photos never collide there.
    const morning = legacy('old-morning', 12, 8);
    const evening = legacy('old-evening', 12, 20);

    const candidates = comparisonCandidatesFor(morning, [morning, evening]);
    expect(candidates.map((p) => p.photoId)).toEqual(['old-evening']);
  });

  it('excludes in-flight uploads', () => {
    const optimistic = photo({
      photoId: 'local-upload-1',
      pose: 'front',
      takenAt: new Date(2026, 7, 9, 12, 0),
      uploading: true,
    });
    const candidates = comparisonCandidatesFor(gallery[0]!, [...gallery, optimistic]);
    expect(candidates.map((p) => p.photoId)).not.toContain('local-upload-1');
  });
});

describe('normalizeBeforeAfter', () => {
  it('keeps a chronological pick in order', () => {
    const older = posed('a', 'front', 1);
    const newer = posed('b', 'front', 20);

    const result = normalizeBeforeAfter(older, newer);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.before.photoId).toBe('a');
    expect(result.after.photoId).toBe('b');
  });

  it('swaps a reverse pick instead of rejecting it', () => {
    const older = posed('a', 'front', 1);
    const newer = posed('b', 'front', 20);

    // Tap order is not a fact about the photos; capture time is.
    const result = normalizeBeforeAfter(newer, older);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.before.photoId).toBe('a');
    expect(result.after.photoId).toBe('b');
  });

  it('rejects two photos from the same instant', () => {
    const at = new Date(2026, 7, 10, 9, 30);
    const a = photo({ photoId: 'a', pose: 'front', takenAt: at });
    const b = photo({ photoId: 'b', pose: 'front', takenAt: new Date(at.getTime()) });

    const result = normalizeBeforeAfter(a, b);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('sameMoment');
  });

  it('rejects a pair from different groups', () => {
    const result = normalizeBeforeAfter(posed('a', 'front', 1), posed('b', 'side', 2));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('differentGroup');
  });

  it('rejects a posed photo paired with a pre-pose one', () => {
    const result = normalizeBeforeAfter(posed('a', 'front', 1), legacy('old-b', 2));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('differentGroup');
  });

  it('orders two pre-pose photos by their real capture time', () => {
    const evening = legacy('old-evening', 12, 20);
    const morning = legacy('old-morning', 12, 8);

    const result = normalizeBeforeAfter(evening, morning);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.before.photoId).toBe('old-morning');
    expect(result.after.photoId).toBe('old-evening');
  });
});

describe('the pairing rules touch nothing but metadata', () => {
  it('imports no Firebase, Storage, crypto, cache or React module', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultCompare.ts', 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    for (const forbidden of [
      'firebase',
      'progressPhotos',
      'photoVaultEncryptedCache',
      'photoVaultCrypto',
      'photoVaultFileCrypto',
      'downloadProgressPhoto',
      'expo-file-system',
      'expo-sharing',
      'react-native-view-shot',
      'react',
    ]) {
      expect(code, `pairing rules must not reference ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it('does not mutate the gallery it was given', () => {
    const photos = [posed('a', 'front', 1), posed('b', 'front', 2), legacy('old', 3)];
    const snapshot = photos.map((p) => p.photoId);

    canCompareProgressPhotos(photos);
    comparisonStartCandidates(photos);
    comparisonCandidatesFor(photos[0]!, photos);
    normalizeBeforeAfter(photos[0]!, photos[1]!);

    expect(photos.map((p) => p.photoId)).toEqual(snapshot);
  });
});
