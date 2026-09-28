import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';

import { processSupportRetention } from '../support';
import { UnsupportedRetentionActionError } from '../types';
import { createFakeFirestore } from './fakeFirestore';
import { createFakeBucket } from './fakeBucket';

function depsFor(
  fsHarness: ReturnType<typeof createFakeFirestore>,
  bucketHarness: ReturnType<typeof createFakeBucket> = createFakeBucket(),
) {
  return {
    db: fsHarness.db as unknown as Firestore,
    storage: { bucket: () => bucketHarness.bucket } as unknown as Storage,
  };
}

function seedCase(
  fs: ReturnType<typeof createFakeFirestore>,
  caseId: string,
  uid: string,
  options: { message?: boolean; action?: boolean; uploadStatus?: 'ATTACHED' | 'STAGED' } = {},
) {
  const storagePath = `users/${uid}/support-v2/staged/upload-${caseId}`;
  fs.seed(`supportCases/${caseId}`, { ownerUid: uid, state: 'CHAT_OPEN' });
  if (options.message) {
    fs.seed(`supportCases/${caseId}/messages/message-${caseId}`, {
      senderId: uid,
      attachments: [{ storagePath }],
    });
  }
  if (options.action) fs.seed(`supportCases/${caseId}/_actions/action-${caseId}`, { adminUid: 'admin-1' });
  if (options.uploadStatus) {
    fs.seed(`supportUploadSessions/upload-${caseId}`, {
      ownerUid: uid,
      caseId: options.uploadStatus === 'ATTACHED' ? caseId : undefined,
      status: options.uploadStatus,
      storagePath,
    });
  }
  return storagePath;
}

describe('processSupportRetention — Support V2 RETAIN', () => {
  it('is idempotent for an owner with no support cases', async () => {
    const fs = createFakeFirestore();
    await expect(processSupportRetention('uid-1', 'RETAIN', depsFor(fs))).resolves.toEqual({
      category: 'support', action: 'RETAIN', outcome: 'RETAINED', resourceCount: 0,
    });
  });

  it('preserves case, messages, actions, sessions, rate limits and Storage objects', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    const path = seedCase(fs, 'case-1', 'uid-1', { message: true, action: true, uploadStatus: 'ATTACHED' });
    fs.seed('supportRateLimits/uid-1_create-case', { ownerUid: 'uid-1' });
    bucket.seed(path);

    const result = await processSupportRetention('uid-1', 'RETAIN', depsFor(fs, bucket));

    expect(result.resourceCount).toBe(1);
    expect(fs.exists('supportCases/case-1')).toBe(true);
    expect(fs.exists('supportCases/case-1/messages/message-case-1')).toBe(true);
    expect(fs.exists('supportCases/case-1/_actions/action-case-1')).toBe(true);
    expect(fs.exists('supportUploadSessions/upload-case-1')).toBe(true);
    expect(fs.exists('supportRateLimits/uid-1_create-case')).toBe(true);
    expect(bucket.exists(path)).toBe(true);
  });
});

describe('processSupportRetention — Support V2 DELETE', () => {
  it('deletes a complete case graph, ATTACHED session and corresponding Storage object', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    const path = seedCase(fs, 'case-1', 'uid-1', { message: true, action: true, uploadStatus: 'ATTACHED' });
    fs.seed('supportRateLimits/uid-1_create-case', { ownerUid: 'uid-1' });
    bucket.seed(path);

    const result = await processSupportRetention('uid-1', 'DELETE', depsFor(fs, bucket));

    expect(result).toEqual({ category: 'support', action: 'DELETE', outcome: 'DELETED', resourceCount: 1 });
    expect(fs.listUnder('supportCases/case-1')).toEqual([]);
    expect(fs.exists('supportUploadSessions/upload-case-1')).toBe(false);
    expect(fs.exists('supportRateLimits/uid-1_create-case')).toBe(false);
    expect(bucket.exists(path)).toBe(false);
  });

  it('deletes a pending STAGED upload even when no case exists', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    const path = 'users/uid-1/support-v2/staged/pending-upload';
    fs.seed('supportUploadSessions/pending-upload', {
      ownerUid: 'uid-1', status: 'STAGED', storagePath: path,
    });
    bucket.seed(path);

    const result = await processSupportRetention('uid-1', 'DELETE', depsFor(fs, bucket));

    expect(result.outcome).toBe('DELETED');
    expect(result.resourceCount).toBe(0);
    expect(fs.exists('supportUploadSessions/pending-upload')).toBe(false);
    expect(bucket.exists(path)).toBe(false);
  });

  it('removes an orphaned object under the owner prefix after a partial prior attempt', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    const path = 'users/uid-1/support-v2/staged/orphaned-object';
    bucket.seed(path);

    const result = await processSupportRetention('uid-1', 'DELETE', depsFor(fs, bucket));

    expect(result.outcome).toBe('DELETED');
    expect(bucket.exists(path)).toBe(false);
  });

  it('is idempotent when repeated after every resource is absent', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    seedCase(fs, 'case-1', 'uid-1');
    await processSupportRetention('uid-1', 'DELETE', depsFor(fs, bucket));

    await expect(processSupportRetention('uid-1', 'DELETE', depsFor(fs, bucket))).resolves.toEqual({
      category: 'support', action: 'DELETE', outcome: 'ALREADY_ABSENT', resourceCount: 0,
    });
  });

  it('keeps the parent retry anchor after a Storage failure and resumes safely', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    const path = seedCase(fs, 'case-1', 'uid-1', { message: true, action: true, uploadStatus: 'ATTACHED' });
    bucket.seed(path);
    bucket.failNextDelete(Object.assign(new Error('unavailable'), { code: 503 }));

    await expect(processSupportRetention('uid-1', 'DELETE', depsFor(fs, bucket))).rejects.toThrow('unavailable');
    expect(fs.exists('supportCases/case-1')).toBe(true);
    expect(fs.exists('supportCases/case-1/messages/message-case-1')).toBe(true);

    await expect(processSupportRetention('uid-1', 'DELETE', depsFor(fs, bucket))).resolves.toMatchObject({
      outcome: 'DELETED', resourceCount: 1,
    });
    expect(fs.listUnder('supportCases/case-1')).toEqual([]);
    expect(bucket.exists(path)).toBe(false);
  });

  it('never mutates cases, sessions, rate limits or Storage owned only by another uid', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    const otherPath = seedCase(fs, 'case-other', 'uid-B', { message: true, action: true, uploadStatus: 'ATTACHED' });
    fs.seed('supportRateLimits/uid-B_create-case', { ownerUid: 'uid-B' });
    bucket.seed(otherPath);

    await processSupportRetention('uid-A', 'DELETE', depsFor(fs, bucket));

    expect(fs.exists('supportCases/case-other')).toBe(true);
    expect(fs.exists('supportUploadSessions/upload-case-other')).toBe(true);
    expect(fs.exists('supportRateLimits/uid-B_create-case')).toBe(true);
    expect(bucket.exists(otherPath)).toBe(true);
  });
});

describe('processSupportRetention — ANONYMIZE', () => {
  it('fails explicitly because no reviewed anonymization contract exists', async () => {
    const fs = createFakeFirestore();
    seedCase(fs, 'case-1', 'uid-1');
    await expect(processSupportRetention('uid-1', 'ANONYMIZE', depsFor(fs))).rejects.toBeInstanceOf(
      UnsupportedRetentionActionError,
    );
    expect(fs.exists('supportCases/case-1')).toBe(true);
  });
});
