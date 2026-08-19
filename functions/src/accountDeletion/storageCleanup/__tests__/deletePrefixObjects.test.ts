import { describe, expect, it } from 'vitest';

import { deletePrefixObjects } from '../deletePrefixObjects';
import { createFakeBucket } from './fakeBucket';

function seedMany(harness: ReturnType<typeof createFakeBucket>, prefix: string, count: number) {
  for (let i = 0; i < count; i++) {
    harness.seed(`${prefix}obj-${String(i).padStart(4, '0')}.enc`);
  }
}

describe('deletePrefixObjects — empty prefix (logical success)', () => {
  it('an empty prefix returns deletedCount: 0, never an error', async () => {
    const harness = createFakeBucket();
    await expect(deletePrefixObjects(harness.bucket, 'users/uid-1/profile/')).resolves.toEqual({
      deletedCount: 0,
    });
  });
});

describe('deletePrefixObjects — basic delete', () => {
  it('deletes every object under the prefix', async () => {
    const harness = createFakeBucket();
    seedMany(harness, 'users/uid-1/progressPhotos/', 4);

    const result = await deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/');

    expect(result).toEqual({ deletedCount: 4 });
    expect(harness.listUnder('users/uid-1/progressPhotos/')).toEqual([]);
  });
});

describe('deletePrefixObjects — pagination/scale', () => {
  it('deletes hundreds of objects across multiple pages', async () => {
    const harness = createFakeBucket();
    seedMany(harness, 'users/uid-1/progressPhotos/', 850);

    const result = await deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/', 100);

    expect(result).toEqual({ deletedCount: 850 });
    expect(harness.listUnder('users/uid-1/progressPhotos/')).toHaveLength(0);
  });
});

describe('deletePrefixObjects — idempotency', () => {
  it('running it a second time after full deletion returns deletedCount: 0', async () => {
    const harness = createFakeBucket();
    seedMany(harness, 'users/uid-1/progressPhotos/', 10);

    await deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/');
    const second = await deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/');

    expect(second).toEqual({ deletedCount: 0 });
  });

  it('a second pass over an already-fully-deleted prefix never surfaces a "not found" error', async () => {
    const harness = createFakeBucket();
    seedMany(harness, 'users/uid-1/progressPhotos/', 3);

    await deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/'); // first pass deletes all 3
    await expect(deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/')).resolves.toEqual({
      deletedCount: 0,
    });
  });
});

describe('deletePrefixObjects — retry after transient failure', () => {
  it('a listing failure propagates, and a retry completes the work', async () => {
    const harness = createFakeBucket();
    seedMany(harness, 'users/uid-1/progressPhotos/', 5);

    harness.failNextGetFiles(new Error('simulated transient listing failure'));
    await expect(deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/')).rejects.toThrow(
      'simulated transient listing failure',
    );
    expect(harness.listUnder('users/uid-1/progressPhotos/')).toHaveLength(5); // untouched

    const retry = await deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/');
    expect(retry).toEqual({ deletedCount: 5 });
  });

  it('a delete failure propagates, and a retry finishes the remaining objects', async () => {
    const harness = createFakeBucket();
    seedMany(harness, 'users/uid-1/progressPhotos/', 5);

    harness.failNextDelete(new Error('simulated transient delete failure'));
    await expect(deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/')).rejects.toThrow(
      'simulated transient delete failure',
    );

    const retry = await deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/');
    expect(retry.deletedCount).toBeGreaterThan(0);
    expect(harness.listUnder('users/uid-1/progressPhotos/')).toHaveLength(0);
  });
});

describe('deletePrefixObjects — real Storage Emulator quirk (null nextQuery)', () => {
  it('does not crash when getFiles() returns null instead of {} for the second tuple element (real emulator behavior, discovered in the Fase 7 integration test)', async () => {
    const harness = createFakeBucket({ emulatorNullNextQuery: true });
    seedMany(harness, 'users/uid-1/progressPhotos/', 4);

    const result = await deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/');

    expect(result).toEqual({ deletedCount: 4 });
    expect(harness.listUnder('users/uid-1/progressPhotos/')).toEqual([]);
  });

  it('an empty prefix with the null-nextQuery quirk still returns deletedCount: 0', async () => {
    const harness = createFakeBucket({ emulatorNullNextQuery: true });
    await expect(deletePrefixObjects(harness.bucket, 'users/uid-1/profile/')).resolves.toEqual({
      deletedCount: 0,
    });
  });
});

describe('deletePrefixObjects — other uid / other prefix isolation', () => {
  it('never touches objects outside the given prefix', async () => {
    const harness = createFakeBucket();
    seedMany(harness, 'users/uid-A/progressPhotos/', 4);
    seedMany(harness, 'users/uid-B/progressPhotos/', 4);

    await deletePrefixObjects(harness.bucket, 'users/uid-A/progressPhotos/');

    expect(harness.listUnder('users/uid-A/progressPhotos/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-B/progressPhotos/')).toHaveLength(4);
  });

  it('a prefix that only partially matches another (e.g. "support" vs "progressPhotos") is never confused', async () => {
    const harness = createFakeBucket();
    harness.seed('users/uid-1/support/ticket-1/attachments/photo.jpg');
    harness.seed('users/uid-1/progressPhotos/p1.enc');

    await deletePrefixObjects(harness.bucket, 'users/uid-1/progressPhotos/');

    expect(harness.exists('users/uid-1/support/ticket-1/attachments/photo.jpg')).toBe(true);
    expect(harness.exists('users/uid-1/progressPhotos/p1.enc')).toBe(false);
  });
});
