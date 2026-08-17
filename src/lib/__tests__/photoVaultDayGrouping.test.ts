import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ logIssue: vi.fn() }));

vi.mock('../photoVaultErrors', () => ({
  logPhotoVaultIssue: (...args: unknown[]) => mocks.logIssue(...args),
}));

import {
  POSE_SLOTS,
  PROGRESS_PHOTO_FILTERS,
  filterProgressDays,
  groupProgressPhotosByDay,
} from '../photoVaultDayGrouping';
import type { GalleryPhoto } from '../photoVaultGallery';
import type { ProgressPhotoPose } from '../photoVaultIdentity';

/**
 * Builds a gallery entry. Only the fields the grouper reads are meaningful;
 * the rest mirror the controller's own defaults.
 */
function photo(params: {
  photoId: string;
  takenAt: Date;
  pose?: ProgressPhotoPose;
  dateKey?: string;
}): GalleryPhoto {
  return {
    photoId: params.photoId,
    assetId: `asset-${params.photoId}`,
    ...(params.pose ? { pose: params.pose } : {}),
    ...(params.dateKey ? { dateKey: params.dateKey } : {}),
    takenAt: params.takenAt,
    metadata: null,
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

/** A posed photo, as the client writes them from phase 14B onward. */
function posed(dateKey: string, pose: ProgressPhotoPose): GalleryPhoto {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return photo({
    photoId: `${dateKey}_${pose}`,
    takenAt: new Date(y, m - 1, d, 12, 0),
    pose,
    dateKey,
  });
}

/** A photo recorded before poses existed: no pose, no stored day. */
function legacy(id: string, takenAt: Date): GalleryPhoto {
  return photo({ photoId: id, takenAt });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('grouping posed photos', () => {
  it('returns nothing for an empty gallery', () => {
    expect(groupProgressPhotosByDay([])).toEqual([]);
  });

  it('places a single front photo in its own day', () => {
    const days = groupProgressPhotosByDay([posed('2026-08-15', 'front')]);

    expect(days).toHaveLength(1);
    expect(days[0]!.dateKey).toBe('2026-08-15');
    expect(days[0]!.front?.photoId).toBe('2026-08-15_front');
    expect(days[0]!.side).toBeUndefined();
    expect(days[0]!.back).toBeUndefined();
    expect(days[0]!.unclassified).toEqual([]);
  });

  it('fills all three slots of one day', () => {
    const days = groupProgressPhotosByDay([
      posed('2026-08-15', 'front'),
      posed('2026-08-15', 'side'),
      posed('2026-08-15', 'back'),
    ]);

    expect(days).toHaveLength(1);
    expect(days[0]!.front).toBeDefined();
    expect(days[0]!.side).toBeDefined();
    expect(days[0]!.back).toBeDefined();
  });

  it('places poses of different days in different groups', () => {
    const days = groupProgressPhotosByDay([
      posed('2026-08-15', 'front'),
      posed('2026-08-10', 'side'),
    ]);

    expect(days.map((day) => day.dateKey)).toEqual(['2026-08-15', '2026-08-10']);
    expect(days[0]!.front).toBeDefined();
    expect(days[1]!.side).toBeDefined();
  });

  it('orders days newest first regardless of input order', () => {
    const days = groupProgressPhotosByDay([
      posed('2026-07-02', 'front'),
      posed('2026-08-15', 'front'),
      posed('2026-01-31', 'front'),
      posed('2026-08-01', 'front'),
    ]);

    expect(days.map((day) => day.dateKey)).toEqual([
      '2026-08-15',
      '2026-08-01',
      '2026-07-02',
      '2026-01-31',
    ]);
  });

  it('keeps slot order fixed no matter how the photos arrived', () => {
    const days = groupProgressPhotosByDay([
      posed('2026-08-15', 'back'),
      posed('2026-08-15', 'front'),
      posed('2026-08-15', 'side'),
    ]);

    // The visual order is a property of the slots, not of arrival order.
    expect([...POSE_SLOTS]).toEqual(['front', 'side', 'back']);
    const day = days[0]!;
    expect(POSE_SLOTS.map((pose) => day[pose]?.pose)).toEqual(['front', 'side', 'back']);
  });

  it('crosses a year boundary correctly', () => {
    const days = groupProgressPhotosByDay([
      posed('2025-12-31', 'front'),
      posed('2026-01-01', 'front'),
    ]);

    expect(days.map((day) => day.dateKey)).toEqual(['2026-01-01', '2025-12-31']);
  });
});

describe('month boundaries', () => {
  it('marks the first day of each month in the ordered result', () => {
    const days = groupProgressPhotosByDay([
      posed('2026-08-15', 'front'),
      posed('2026-08-01', 'front'),
      posed('2026-07-20', 'front'),
      posed('2026-06-30', 'front'),
    ]);

    expect(days.map((day) => day.startsMonth)).toEqual([true, false, true, true]);
    expect(days.map((day) => day.monthKey)).toEqual([
      '2026-08',
      '2026-08',
      '2026-07',
      '2026-06',
    ]);
  });

  it('exposes a date usable for locale aware formatting', () => {
    const [day] = groupProgressPhotosByDay([posed('2026-08-15', 'front')]);

    // Local components, so a formatter never shifts the label by a day.
    expect(day!.date.getFullYear()).toBe(2026);
    expect(day!.date.getMonth()).toBe(7);
    expect(day!.date.getDate()).toBe(15);
  });
});

describe('photos recorded before poses', () => {
  it('groups them by their local capture day', () => {
    const days = groupProgressPhotosByDay([legacy('old-a', new Date(2026, 7, 15, 9, 0))]);

    expect(days).toHaveLength(1);
    expect(days[0]!.dateKey).toBe('2026-08-15');
  });

  it('keeps a late evening photo on its local day', () => {
    // The UTC day has already rolled over at 23:30 in any zone behind UTC.
    const days = groupProgressPhotosByDay([legacy('old-a', new Date(2026, 7, 15, 23, 30))]);

    expect(days[0]!.dateKey).toBe('2026-08-15');
  });

  it('never guesses a pose for them', () => {
    const days = groupProgressPhotosByDay([
      legacy('old-a', new Date(2026, 7, 15, 9, 0)),
      legacy('old-b', new Date(2026, 7, 15, 10, 0)),
    ]);

    const day = days[0]!;
    expect(day.front).toBeUndefined();
    expect(day.side).toBeUndefined();
    expect(day.back).toBeUndefined();
    expect(day.unclassified.map((entry) => entry.photoId)).toEqual(['old-a', 'old-b']);
  });

  it('shares a day with posed photos without displacing them', () => {
    const days = groupProgressPhotosByDay([
      posed('2026-08-15', 'front'),
      legacy('old-a', new Date(2026, 7, 15, 9, 0)),
      posed('2026-08-15', 'back'),
    ]);

    expect(days).toHaveLength(1);
    const day = days[0]!;
    expect(day.front?.photoId).toBe('2026-08-15_front');
    expect(day.back?.photoId).toBe('2026-08-15_back');
    expect(day.unclassified.map((entry) => entry.photoId)).toEqual(['old-a']);
  });

  it('never disappears, whatever the day contains', () => {
    const photos = [
      posed('2026-08-15', 'front'),
      legacy('old-a', new Date(2026, 7, 15, 9, 0)),
      legacy('old-b', new Date(2026, 6, 4, 9, 0)),
    ];
    const days = groupProgressPhotosByDay(photos);

    const seen = days.flatMap((day) => [
      ...POSE_SLOTS.map((pose) => day[pose]?.photoId).filter(Boolean),
      ...day.unclassified.map((entry) => entry.photoId),
    ]);
    expect(seen.sort()).toEqual(photos.map((entry) => entry.photoId).sort());
  });
});

describe('optimistic uploads', () => {
  it('treats an entry with no pose yet as unclassified', () => {
    const optimistic = photo({ photoId: 'local-upload-1', takenAt: new Date(2026, 7, 15, 9, 0) });
    const days = groupProgressPhotosByDay([optimistic]);

    expect(days[0]!.unclassified.map((entry) => entry.photoId)).toEqual(['local-upload-1']);
  });
});

describe('duplicate slots are handled defensively', () => {
  it('keeps the first occurrence and demotes the rest', () => {
    const first = posed('2026-08-15', 'front');
    const second = { ...posed('2026-08-15', 'front'), photoId: 'duplicate-front' };

    const days = groupProgressPhotosByDay([first, second]);

    // The database makes this impossible; corrupted data must not win.
    expect(days[0]!.front?.photoId).toBe(first.photoId);
    expect(days[0]!.unclassified.map((entry) => entry.photoId)).toEqual(['duplicate-front']);
  });

  it('does not hide the extra photo', () => {
    const days = groupProgressPhotosByDay([
      posed('2026-08-15', 'front'),
      { ...posed('2026-08-15', 'front'), photoId: 'duplicate-front' },
    ]);

    const total =
      POSE_SLOTS.filter((pose) => days[0]![pose]).length + days[0]!.unclassified.length;
    expect(total).toBe(2);
  });

  it('does not disturb the other slots', () => {
    const days = groupProgressPhotosByDay([
      posed('2026-08-15', 'front'),
      { ...posed('2026-08-15', 'front'), photoId: 'duplicate-front' },
      posed('2026-08-15', 'side'),
      posed('2026-08-15', 'back'),
    ]);

    expect(days[0]!.side?.photoId).toBe('2026-08-15_side');
    expect(days[0]!.back?.photoId).toBe('2026-08-15_back');
  });

  it('reports one sanitized aggregate instead of leaking identifiers', () => {
    groupProgressPhotosByDay([
      posed('2026-08-15', 'front'),
      { ...posed('2026-08-15', 'front'), photoId: 'duplicate-front' },
      { ...posed('2026-08-15', 'side'), photoId: 'duplicate-side' },
      posed('2026-08-15', 'side'),
    ]);

    expect(mocks.logIssue).toHaveBeenCalledTimes(1);
    const [scope, issue, ...rest] = mocks.logIssue.mock.calls[0] as string[];
    expect(scope).toBe('photoVault.dayGrouping');
    expect(issue).toBe('vaultMetadataInvalid');
    // No photoId, day or pose may reach the log.
    expect(rest).toEqual([]);
  });

  it('stays silent when nothing is wrong', () => {
    groupProgressPhotosByDay([posed('2026-08-15', 'front'), posed('2026-08-15', 'side')]);
    expect(mocks.logIssue).not.toHaveBeenCalled();
  });
});

describe('the projection touches nothing but metadata', () => {
  it('imports no Firebase, Storage, crypto or cache module', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultDayGrouping.ts', 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    for (const forbidden of [
      'firebase',
      'progressPhotos',
      'photoVaultEncryptedCache',
      'photoVaultCrypto',
      'photoVaultFileCrypto',
      'decrypt',
      'getBytes',
      'thumbnailUri',
      'expo-file-system',
    ]) {
      expect(code, `grouping must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('does not mutate the photos it was given', () => {
    const photos = [posed('2026-08-15', 'front'), legacy('old-a', new Date(2026, 7, 15, 9, 0))];
    const snapshot = JSON.stringify(photos);

    groupProgressPhotosByDay(photos);

    expect(JSON.stringify(photos)).toBe(snapshot);
  });

  it('handles a large gallery without any per-day work beyond grouping', () => {
    const photos = Array.from({ length: 900 }, (_, index) =>
      posed(`2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
        POSE_SLOTS[index % 3]!),
    );

    const days = groupProgressPhotosByDay(photos);
    // Every photo is accounted for exactly once.
    const placed = days.reduce(
      (total, day) =>
        total + POSE_SLOTS.filter((pose) => day[pose]).length + day.unclassified.length,
      0,
    );
    expect(placed).toBe(photos.length);
  });
});


// ── Pose filter (phase 14E) ────────────────────────────────────────────────

describe('filtering the day projection', () => {
  const gallery = () =>
    groupProgressPhotosByDay([
      posed('2026-08-15', 'front'),
      legacy('old-a', new Date(2026, 7, 15, 9, 0)),
      posed('2026-08-10', 'side'),
      posed('2026-08-10', 'back'),
      posed('2026-07-20', 'front'),
    ]);

  it('offers exactly the four selections', () => {
    expect([...PROGRESS_PHOTO_FILTERS]).toEqual(['all', 'front', 'side', 'back']);
  });

  it('all shows every pose and the unclassified photos', () => {
    const days = filterProgressDays(gallery(), 'all');

    expect(days.map((day) => day.dateKey)).toEqual(['2026-08-15', '2026-08-10', '2026-07-20']);
    expect(days[0]!.front).toBeDefined();
    expect(days[0]!.unclassified).toHaveLength(1);
    expect(days[1]!.side).toBeDefined();
    expect(days[1]!.back).toBeDefined();
  });

  it('front keeps only days that have a front photo', () => {
    const days = filterProgressDays(gallery(), 'front');

    expect(days.map((day) => day.dateKey)).toEqual(['2026-08-15', '2026-07-20']);
    for (const day of days) {
      expect(day.front).toBeDefined();
      expect(day.side).toBeUndefined();
      expect(day.back).toBeUndefined();
    }
  });

  it('side keeps only days that have a side photo', () => {
    const days = filterProgressDays(gallery(), 'side');

    expect(days.map((day) => day.dateKey)).toEqual(['2026-08-10']);
    expect(days[0]!.side).toBeDefined();
    expect(days[0]!.back).toBeUndefined();
  });

  it('back keeps only days that have a back photo', () => {
    const days = filterProgressDays(gallery(), 'back');

    expect(days.map((day) => day.dateKey)).toEqual(['2026-08-10']);
    expect(days[0]!.back).toBeDefined();
    expect(days[0]!.side).toBeUndefined();
  });

  it('never shows a pre-pose photo under a pose filter', () => {
    // Their pose is genuinely unknown; showing them as "front" would be a lie.
    for (const pose of POSE_SLOTS) {
      for (const day of filterProgressDays(gallery(), pose)) {
        expect(day.unclassified).toEqual([]);
      }
    }
    // They remain reachable under `all`.
    const all = filterProgressDays(gallery(), 'all');
    expect(all.some((day) => day.unclassified.length > 0)).toBe(true);
  });

  it('drops a day whose only photo was another pose', () => {
    const days = filterProgressDays(
      groupProgressPhotosByDay([posed('2026-08-15', 'side')]),
      'front',
    );
    expect(days).toEqual([]);
  });

  it('returns nothing for an empty gallery', () => {
    expect(filterProgressDays([], 'front')).toEqual([]);
  });
});

describe('month headings survive filtering', () => {
  it('promotes the next visible day when the first of a month is filtered out', () => {
    // August opens with the 15th, which has only a front photo.
    const days = groupProgressPhotosByDay([
      posed('2026-08-15', 'front'),
      posed('2026-08-10', 'side'),
      posed('2026-07-20', 'side'),
    ]);
    expect(days[0]!.startsMonth).toBe(true);

    const sideOnly = filterProgressDays(days, 'side');

    // The 10th is now the first August day visible, so it must open the month.
    expect(sideOnly.map((day) => day.dateKey)).toEqual(['2026-08-10', '2026-07-20']);
    expect(sideOnly[0]!.startsMonth).toBe(true);
    expect(sideOnly[1]!.startsMonth).toBe(true);
  });

  it('keeps only one heading per month after filtering', () => {
    const days = filterProgressDays(
      groupProgressPhotosByDay([
        posed('2026-08-15', 'front'),
        posed('2026-08-10', 'front'),
        posed('2026-08-01', 'front'),
      ]),
      'front',
    );

    expect(days.map((day) => day.startsMonth)).toEqual([true, false, false]);
  });
});

describe('filtering is a pure projection', () => {
  it('does not mutate the days it was given', () => {
    const days = groupProgressPhotosByDay([
      posed('2026-08-15', 'front'),
      posed('2026-08-15', 'side'),
      legacy('old-a', new Date(2026, 7, 15, 9, 0)),
    ]);
    const before = {
      startsMonth: days[0]!.startsMonth,
      front: days[0]!.front,
      side: days[0]!.side,
      unclassified: [...days[0]!.unclassified],
    };

    filterProgressDays(days, 'front');

    // Switching filters must not leak state between views.
    expect(days[0]!.startsMonth).toBe(before.startsMonth);
    expect(days[0]!.front).toBe(before.front);
    expect(days[0]!.side).toBe(before.side);
    expect(days[0]!.unclassified).toEqual(before.unclassified);
  });

  it('returns the same photo objects, so nothing is re-fetched', () => {
    const days = groupProgressPhotosByDay([posed('2026-08-15', 'front')]);
    const filtered = filterProgressDays(days, 'front');

    // Identity preserved: the thumbnail already loaded stays loaded.
    expect(filtered[0]!.front).toBe(days[0]!.front);
    expect(filtered[0]!.front!.assetId).toBe(days[0]!.front!.assetId);
  });

  it('hands `all` straight through without rebuilding', () => {
    const days = groupProgressPhotosByDay([posed('2026-08-15', 'front')]);
    expect(filterProgressDays(days, 'all')).toBe(days);
  });
});

describe('optimistic uploads under a filter', () => {
  it('shows an uploading pose under all and under its own pose only', () => {
    const uploading = {
      ...posed('2026-08-15', 'front'),
      photoId: 'local-upload-1',
      uploadStatus: 'uploading' as const,
    };
    const days = groupProgressPhotosByDay([uploading]);

    expect(filterProgressDays(days, 'all')[0]?.front?.uploadStatus).toBe('uploading');
    expect(filterProgressDays(days, 'front')[0]?.front?.uploadStatus).toBe('uploading');
    expect(filterProgressDays(days, 'side')).toEqual([]);
    expect(filterProgressDays(days, 'back')).toEqual([]);
  });
});
