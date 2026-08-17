import { describe, expect, it } from 'vitest';

import {
  comparisonElapsedDays,
  normalizeBeforeAfter,
} from '../photoVaultCompare';
import type { GalleryPhoto } from '../photoVaultGallery';

function civil(dateKey: string, takenAt = new Date(`${dateKey}T12:00:00Z`)) {
  return { dateKey, takenAt } satisfies Pick<GalleryPhoto, 'dateKey' | 'takenAt'>;
}

function galleryPhoto(
  photoId: string,
  dateKey: string,
  takenAt: Date,
): GalleryPhoto {
  return {
    photoId,
    assetId: `asset-${photoId}`,
    pose: 'front',
    dateKey,
    takenAt,
    metadata: {} as GalleryPhoto['metadata'],
    thumbnailUri: null,
    fullUri: null,
    previewUri: null,
    thumbnailLoading: false,
    fullLoading: false,
    failed: false,
    uploadStatus: null,
    uploadProgress: null,
  };
}

describe('comparisonElapsedDays', () => {
  it('returns zero for two real captures on the same civil day', () => {
    expect(
      comparisonElapsedDays(
        civil('2026-01-10', new Date('2026-01-10T08:00:00Z')),
        civil('2026-01-10', new Date('2026-01-10T20:00:00Z')),
      ),
    ).toBe(0);
  });

  it.each([
    ['one day', '2026-01-10', '2026-01-11', 1],
    ['thirty days', '2026-01-01', '2026-01-31', 30],
    ['365 days', '2025-01-01', '2026-01-01', 365],
    ['month boundary', '2026-01-31', '2026-02-01', 1],
    ['year boundary', '2025-12-31', '2026-01-01', 1],
    ['leap day', '2024-02-28', '2024-03-01', 2],
    ['from February 29', '2024-02-29', '2024-03-01', 1],
  ])('handles %s', (_name, before, after, expected) => {
    expect(comparisonElapsedDays(civil(before), civil(after))).toBe(expected);
  });

  it('uses the pair after its real takenAt chronology has been normalized', () => {
    const older = galleryPhoto(
      'older',
      '2026-04-02',
      new Date('2026-04-02T12:00:00Z'),
    );
    const newer = galleryPhoto(
      'newer',
      '2026-05-02',
      new Date('2026-05-02T12:00:00Z'),
    );
    const pair = normalizeBeforeAfter(newer, older);

    expect(pair.ok).toBe(true);
    if (!pair.ok) return;
    expect(comparisonElapsedDays(pair.before, pair.after)).toBe(30);
  });

  it('is DST-safe because persisted civil days do not subtract local midnights', () => {
    const before = civil(
      '2026-03-08',
      new Date('2026-03-08T01:30:00-05:00'),
    );
    const after = civil(
      '2026-03-09',
      new Date('2026-03-09T01:30:00-04:00'),
    );

    // The instants are only 23 hours apart, but these are adjacent civil days.
    expect(after.takenAt.getTime() - before.takenAt.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
    expect(comparisonElapsedDays(before, after)).toBe(1);
  });

  it('uses the established local takenAt fallback for legacy photos', () => {
    const before = { takenAt: new Date(2026, 6, 14, 23, 30) };
    const after = { takenAt: new Date(2026, 6, 15, 0, 30) };

    expect(comparisonElapsedDays(before, after)).toBe(1);
  });

  it('never returns a negative period for a defensive reverse call', () => {
    expect(
      comparisonElapsedDays(civil('2026-08-17'), civil('2026-08-01')),
    ).toBe(0);
  });
});
