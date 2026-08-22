import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

import {
  deleteProgressPhotoDocuments,
  deleteUserAssessments,
  deleteUserProfileDocument,
  deleteUserQuestionnaires,
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
