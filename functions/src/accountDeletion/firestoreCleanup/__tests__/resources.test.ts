import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

import {
  deleteProgressPhotoDocuments,
  deleteUserAssessments,
  deleteUserProfileDocument,
  deleteUserQuestionnaires,
  deleteUserWorkoutProgramDescendants,
  deleteUserNotificationDispatches,
  deleteUserDailyNotificationRegistration,
  deleteUserNotificationProductWindows,
  deleteUserNotificationAchievementMilestones,
  deleteUserPushDevices,
  deleteUserPushTokenOwners,
  releaseUserPushInstallations,
} from '../resources';
import { createFakeFirestore } from './fakeFirestore';

function fs(harness: ReturnType<typeof createFakeFirestore>): Firestore {
  return harness.db as unknown as Firestore;
}

describe('deleteUserQuestionnaires', () => {
  it('deletes every questionnaire under the uid and reports the count', async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-1/questionnaires/q1');
    harness.seed('users/uid-1/questionnaires/q2');

    const result = await deleteUserQuestionnaires('uid-1', fs(harness));

    expect(result).toEqual({ resource: 'questionnaires', deletedCount: 2, alreadyAbsent: false });
    expect(harness.listUnder('users/uid-1/questionnaires/')).toHaveLength(0);
  });

  it('reports alreadyAbsent: true for a uid with none', async () => {
    const harness = createFakeFirestore();
    const result = await deleteUserQuestionnaires('uid-1', fs(harness));
    expect(result).toEqual({ resource: 'questionnaires', deletedCount: 0, alreadyAbsent: true });
  });

  it("never touches another uid's questionnaires", async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-A/questionnaires/q1');
    harness.seed('users/uid-B/questionnaires/q1');

    await deleteUserQuestionnaires('uid-A', fs(harness));

    expect(harness.exists('users/uid-B/questionnaires/q1')).toBe(true);
  });
});

describe('deleteUserAssessments', () => {
  it('deletes every assessment, independent of Premium/Free (no premium check exists in this engine)', async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-1/assessments/a1');
    harness.seed('users/uid-1/assessments/a2');
    harness.seed('users/uid-1/assessments/a3');

    const result = await deleteUserAssessments('uid-1', fs(harness));

    expect(result.deletedCount).toBe(3);
    expect(harness.listUnder('users/uid-1/assessments/')).toHaveLength(0);
  });
});

describe('deleteProgressPhotoDocuments', () => {
  it('deletes the metadata documents only — never claims to touch Storage', async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-1/progressPhotos/p1');
    harness.seed('users/uid-1/progressPhotos/p2');

    const result = await deleteProgressPhotoDocuments('uid-1', fs(harness));

    expect(result).toEqual({ resource: 'progressPhotos', deletedCount: 2, alreadyAbsent: false });
  });
});

describe('push resources', () => {
  it('removes the user projection, raw-token claim and dispatch descendants', async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-1/devices/install-1');
    harness.seed('pushTokenOwners/hash-1', { ownerUid: 'uid-1' });
    harness.seed('notificationDispatches/dispatch-1', { uid: 'uid-1' });
    harness.seed('notificationDispatches/dispatch-1/deliveries/install-1');
    harness.seed('notificationDailyUsers/uid-1', { timezone: 'UTC' });
    harness.seed('notificationProductWindows/window-1', { uid: 'uid-1' });
    harness.seed('notificationProductWindows/window-2', { uid: 'uid-2' });
    harness.seed('notificationAchievementMilestones/milestone-1', { uid: 'uid-1' });
    harness.seed('notificationAchievementMilestones/milestone-2', { uid: 'uid-2' });

    await deleteUserPushDevices('uid-1', fs(harness));
    await deleteUserPushTokenOwners('uid-1', fs(harness));
    await deleteUserNotificationDispatches('uid-1', fs(harness));
    await deleteUserNotificationProductWindows('uid-1', fs(harness));
    await deleteUserNotificationAchievementMilestones('uid-1', fs(harness));
    await deleteUserDailyNotificationRegistration('uid-1', fs(harness));

    expect(harness.exists('users/uid-1/devices/install-1')).toBe(false);
    expect(harness.exists('pushTokenOwners/hash-1')).toBe(false);
    expect(harness.exists('notificationDispatches/dispatch-1')).toBe(false);
    expect(harness.exists('notificationDispatches/dispatch-1/deliveries/install-1')).toBe(false);
    expect(harness.exists('notificationDailyUsers/uid-1')).toBe(false);
    expect(harness.exists('notificationProductWindows/window-1')).toBe(false);
    expect(harness.exists('notificationProductWindows/window-2')).toBe(true);
    expect(harness.exists('notificationAchievementMilestones/milestone-1')).toBe(false);
    expect(harness.exists('notificationAchievementMilestones/milestone-2')).toBe(true);
  });

  it('releases only installations still owned by the deleted account', async () => {
    const harness = createFakeFirestore();
    harness.seed('pushInstallations/owned', {
      ownerUid: 'uid-1',
      tokenHash: 'hash-owned',
      ownershipVersion: 1,
    });
    harness.seed('pushTokenOwners/hash-owned', {
      ownerUid: 'uid-1',
      installationId: 'owned',
      ownershipVersion: 1,
    });
    harness.seed('pushInstallations/transferred', {
      ownerUid: 'uid-2',
      tokenHash: 'hash-transferred',
      ownershipVersion: 2,
    });
    harness.seed('pushTokenOwners/hash-transferred', {
      ownerUid: 'uid-2',
      installationId: 'transferred',
      ownershipVersion: 2,
    });

    await releaseUserPushInstallations('uid-1', fs(harness));

    expect(harness.data('pushInstallations/owned')?.ownerUid).toBeNull();
    expect(harness.exists('pushTokenOwners/hash-owned')).toBe(false);
    expect(harness.data('pushInstallations/transferred')?.ownerUid).toBe('uid-2');
    expect(harness.exists('pushTokenOwners/hash-transferred')).toBe(true);
  });
});

describe('deleteUserWorkoutProgramDescendants', () => {
  it('deletes every known descendant before the workout program document', async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-1/workoutPrograms/wpg1');
    harness.seed('users/uid-1/workoutPrograms/wpg1/progressionEvents/pe1');
    harness.seed('users/uid-1/workoutPrograms/wpg1/scheduleState/state1');
    harness.seed('users/uid-1/workoutPrograms/wpg1/scheduleEvents/event1');

    const result = await deleteUserWorkoutProgramDescendants('uid-1', fs(harness));

    expect(result).toEqual({ resource: 'workoutProgramDescendants', deletedCount: 3, alreadyAbsent: false });
    expect(harness.exists('users/uid-1/workoutPrograms/wpg1')).toBe(true);
    expect(harness.listUnder('users/uid-1/workoutPrograms/wpg1/')).toHaveLength(0);
  });

  it('is idempotent and tolerates empty descendant collections', async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-1/workoutPrograms/wpg1');

    await expect(deleteUserWorkoutProgramDescendants('uid-1', fs(harness))).resolves.toEqual({
      resource: 'workoutProgramDescendants', deletedCount: 0, alreadyAbsent: true,
    });
  });
});

describe('deleteUserProfileDocument', () => {
  it('deletes users/{uid} and reports it existed', async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-1');

    const result = await deleteUserProfileDocument('uid-1', fs(harness));

    expect(result).toEqual({ resource: 'userProfile', deletedCount: 1, alreadyAbsent: false });
    expect(harness.exists('users/uid-1')).toBe(false);
  });

  it('reports alreadyAbsent: true for a missing profile document — logical success, not an error', async () => {
    const harness = createFakeFirestore();
    const result = await deleteUserProfileDocument('uid-1', fs(harness));
    expect(result).toEqual({ resource: 'userProfile', deletedCount: 0, alreadyAbsent: true });
  });

  it('deleting users/{uid} never cascades into privateSecurity — the Vault key survives untouched', async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-1');
    harness.seed('users/uid-1/privateSecurity/photoVault');

    await deleteUserProfileDocument('uid-1', fs(harness));

    expect(harness.exists('users/uid-1')).toBe(false);
    expect(harness.exists('users/uid-1/privateSecurity/photoVault')).toBe(true);
  });

  it('running it twice is safe — the second call is a logical success', async () => {
    const harness = createFakeFirestore();
    harness.seed('users/uid-1');

    await deleteUserProfileDocument('uid-1', fs(harness));
    const second = await deleteUserProfileDocument('uid-1', fs(harness));

    expect(second).toEqual({ resource: 'userProfile', deletedCount: 0, alreadyAbsent: true });
  });
});
