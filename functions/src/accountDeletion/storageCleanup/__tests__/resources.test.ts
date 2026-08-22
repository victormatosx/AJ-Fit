import { describe, expect, it } from 'vitest';
import type { Storage } from 'firebase-admin/storage';

import { InvalidUidError, deleteUserAvatarObjects, deleteUserProgressPhotoObjects } from '../resources';
import { createFakeBucket } from './fakeBucket';

function storageFor(harness: ReturnType<typeof createFakeBucket>): Storage {
  return { bucket: () => harness.bucket } as unknown as Storage;
}

describe('deleteUserAvatarObjects', () => {
  it('deletes every object under users/{uid}/profile/', async () => {
    const harness = createFakeBucket();
    harness.seed('users/uid-1/profile/avatar');

    const result = await deleteUserAvatarObjects('uid-1', storageFor(harness));

    expect(result).toEqual({ resource: 'avatar', deletedCount: 1, alreadyAbsent: false });
    expect(harness.exists('users/uid-1/profile/avatar')).toBe(false);
  });

  it('reports alreadyAbsent: true when there is no avatar', async () => {
    const harness = createFakeBucket();
    const result = await deleteUserAvatarObjects('uid-1', storageFor(harness));
    expect(result).toEqual({ resource: 'avatar', deletedCount: 0, alreadyAbsent: true });
  });

  it("never touches another uid's avatar", async () => {
    const harness = createFakeBucket();
    harness.seed('users/uid-A/profile/avatar');
    harness.seed('users/uid-B/profile/avatar');

    await deleteUserAvatarObjects('uid-A', storageFor(harness));

    expect(harness.exists('users/uid-B/profile/avatar')).toBe(true);
  });

  it('rejects a uid that could escape the intended namespace', async () => {
    const harness = createFakeBucket();
    await expect(deleteUserAvatarObjects('../other-uid', storageFor(harness))).rejects.toBeInstanceOf(
      InvalidUidError,
    );
    await expect(deleteUserAvatarObjects('uid/../escape', storageFor(harness))).rejects.toBeInstanceOf(
      InvalidUidError,
    );
    await expect(deleteUserAvatarObjects('', storageFor(harness))).rejects.toBeInstanceOf(InvalidUidError);
  });
});

describe('deleteUserProgressPhotoObjects', () => {
  it('deletes originals and thumbnails together', async () => {
    const harness = createFakeBucket();
    harness.seed('users/uid-1/progressPhotos/p1.enc');
    harness.seed('users/uid-1/progressPhotos/p1.thumb.enc');
    harness.seed('users/uid-1/progressPhotos/p2.enc');

    const result = await deleteUserProgressPhotoObjects('uid-1', storageFor(harness));

    expect(result.deletedCount).toBe(3);
    expect(harness.listUnder('users/uid-1/progressPhotos/')).toHaveLength(0);
  });

  it('finds and removes an ORPHAN object with no corresponding Firestore document — proven by construction: this function never touches Firestore at all', async () => {
    const harness = createFakeBucket();
    harness.seed('users/uid-1/progressPhotos/orphan-object.enc');

    const result = await deleteUserProgressPhotoObjects('uid-1', storageFor(harness));

    expect(result.deletedCount).toBe(1);
    expect(harness.exists('users/uid-1/progressPhotos/orphan-object.enc')).toBe(false);
  });

  it('never removes a support attachment even though it shares the same users/{uid}/ ancestor', async () => {
    const harness = createFakeBucket();
    harness.seed('users/uid-1/progressPhotos/p1.enc');
    harness.seed('users/uid-1/support/ticket-1/attachments/screenshot.jpg');

    await deleteUserProgressPhotoObjects('uid-1', storageFor(harness));
    await deleteUserAvatarObjects('uid-1', storageFor(harness));

    expect(harness.exists('users/uid-1/support/ticket-1/attachments/screenshot.jpg')).toBe(true);
  });
});
