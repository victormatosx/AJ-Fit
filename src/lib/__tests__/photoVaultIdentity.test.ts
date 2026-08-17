import { describe, expect, it } from 'vitest';

import {
  PROGRESS_PHOTO_POSES,
  isProgressPhotoPose,
  isValidDateKey,
  isVaultUuid,
  localDateKey,
  progressPhotoDocumentId,
  resolveProgressPhotoAssetId,
} from '../photoVaultIdentity';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

function issueOf(error: unknown): string {
  return (error as { issue?: string }).issue ?? 'none';
}

describe('poses', () => {
  it('accepts exactly the three supported poses', () => {
    expect([...PROGRESS_PHOTO_POSES]).toEqual(['front', 'side', 'back']);
    for (const pose of PROGRESS_PHOTO_POSES) expect(isProgressPhotoPose(pose)).toBe(true);
  });

  it('rejects anything else, including a placeholder for old photos', () => {
    // "unknown" must never become a fourth persisted value — the ABSENCE of a
    // pose is what identifies a photo recorded before poses existed.
    for (const value of ['unknown', 'unclassified', 'Front', 'frente', 'profile', '', null, 3]) {
      expect(isProgressPhotoPose(value)).toBe(false);
    }
  });
});

describe('localDateKey', () => {
  // Dates are built from LOCAL components, so these assertions hold in any
  // machine time zone rather than only in UTC.
  it('formats an ordinary day', () => {
    expect(localDateKey(new Date(2026, 7, 15, 12, 0))).toBe('2026-08-15');
  });

  it('pads single digit months and days', () => {
    expect(localDateKey(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('handles the first day of the year', () => {
    expect(localDateKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('handles the last day of the year', () => {
    expect(localDateKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('handles a leap day', () => {
    expect(localDateKey(new Date(2028, 1, 29, 12, 0))).toBe('2028-02-29');
  });

  it('keeps a late evening photo on its local day', () => {
    // The bug this guards against: at 23:30 in any zone behind UTC, the UTC
    // day has already rolled over, so a UTC-based key would file the photo
    // under tomorrow.
    const lateEvening = new Date(2026, 7, 15, 23, 30);
    expect(localDateKey(lateEvening)).toBe('2026-08-15');
    expect(localDateKey(lateEvening)).toBe(
      `${lateEvening.getFullYear()}-08-${lateEvening.getDate()}`,
    );
  });

  it('keeps an early morning photo on its local day', () => {
    // The mirror case for zones ahead of UTC.
    expect(localDateKey(new Date(2026, 7, 15, 0, 15))).toBe('2026-08-15');
  });

  it('always produces a key its own validator accepts', () => {
    for (let month = 0; month < 12; month += 1) {
      const key = localDateKey(new Date(2026, month, 28, 9, 0));
      expect(isValidDateKey(key)).toBe(true);
    }
  });

  it('rejects an invalid date instead of emitting a broken key', () => {
    expect(issueOf(catchOf(() => localDateKey(new Date('nonsense'))))).toBe(
      'vaultMetadataInvalid',
    );
    expect(issueOf(catchOf(() => localDateKey('2026-08-15' as unknown as Date)))).toBe(
      'vaultMetadataInvalid',
    );
  });

  it('never derives the day from the UTC calendar', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultIdentity.ts', 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('toISOString');
    expect(code).not.toContain('getUTC');
  });
});

function catchOf(work: () => unknown): unknown {
  try {
    work();
    return null;
  } catch (error) {
    return error;
  }
}

describe('isValidDateKey', () => {
  it('accepts a well formed key', () => {
    expect(isValidDateKey('2026-08-15')).toBe(true);
    expect(isValidDateKey('2020-01-01')).toBe(true);
  });

  it('rejects malformed keys', () => {
    for (const value of [
      '2026-8-1',
      '15-08-2026',
      '2026/08/15',
      '2026-13-01',
      '2026-00-10',
      '2026-08-32',
      '2026-08-00',
      '2026-08-15T00:00:00Z',
      '',
      null,
      20260815,
    ]) {
      expect(isValidDateKey(value)).toBe(false);
    }
  });
});

describe('progressPhotoDocumentId', () => {
  it('composes the day and the pose', () => {
    expect(progressPhotoDocumentId('2026-08-15', 'front')).toBe('2026-08-15_front');
    expect(progressPhotoDocumentId('2026-08-15', 'side')).toBe('2026-08-15_side');
    expect(progressPhotoDocumentId('2026-08-15', 'back')).toBe('2026-08-15_back');
  });

  it('refuses to build an id from invalid parts', () => {
    expect(issueOf(catchOf(() => progressPhotoDocumentId('15-08-2026', 'front')))).toBe(
      'vaultMetadataInvalid',
    );
    expect(
      issueOf(catchOf(() => progressPhotoDocumentId('2026-08-15', 'unknown' as never))),
    ).toBe('vaultMetadataInvalid');
  });
});

describe('resolveProgressPhotoAssetId', () => {
  it('uses the explicit assetId of a posed document', () => {
    expect(
      resolveProgressPhotoAssetId({ documentId: '2026-08-15_front', assetId: UUID }),
    ).toBe(UUID);
  });

  it('falls back to the document id of a pre-pose document', () => {
    expect(resolveProgressPhotoAssetId({ documentId: UUID })).toBe(UUID);
  });

  it('rejects a non uuid assetId', () => {
    expect(
      issueOf(
        catchOf(() =>
          resolveProgressPhotoAssetId({ documentId: '2026-08-15_front', assetId: 'nope' }),
        ),
      ),
    ).toBe('vaultMetadataInvalid');
  });

  it('rejects a posed document id used as its own asset', () => {
    // Falling through to the document id here would name a Storage object
    // `2026-08-15_front.enc`, leaking the day and pose into the bucket.
    expect(
      issueOf(catchOf(() => resolveProgressPhotoAssetId({ documentId: '2026-08-15_front' }))),
    ).toBe('vaultMetadataInvalid');
  });

  it('rejects an assetId that is present but not a string', () => {
    expect(
      issueOf(catchOf(() => resolveProgressPhotoAssetId({ documentId: UUID, assetId: 42 }))),
    ).toBe('vaultMetadataInvalid');
  });
});

describe('isVaultUuid', () => {
  it('matches the shape the rules and the backend enforce', () => {
    expect(isVaultUuid(UUID)).toBe(true);
    expect(isVaultUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of [
      '2026-08-15_front',
      'photo-1',
      '123e4567e89b42d3a456426614174000',
      '123e4567-e89b-62d3-a456-426614174000',
      '',
      null,
    ]) {
      expect(isVaultUuid(value)).toBe(false);
    }
  });
});
