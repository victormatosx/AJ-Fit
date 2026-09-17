import { describe, expect, it } from 'vitest';

import {
  JOB_MAX_AGE_MS,
  PHOTO_VAULT_UPLOAD_JOB_VERSION,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  createPhotoVaultUploadJob,
  isJobDue,
  isJobExpired,
  isPhotoVaultUploadJob,
  markAssetUploaded,
  markJobFailed,
  markJobSynced,
  markJobUploading,
  markMetadataWritten,
  nextWakeDelayMs,
  parsePhotoVaultUploadJobs,
  retryDelayMs,
  shouldProbeRemoteState,
  type PhotoVaultUploadJob,
} from '../photoVaultUploadJob';

const NOW = 1_800_000_000_000;
const ASSET = '123e4567-e89b-42d3-a456-426614174001';
const OTHER_ASSET = '123e4567-e89b-42d3-a456-426614174002';

function encryption(iv: string) {
  return { version: 1, algorithm: 'AES-256-GCM', iv, vaultKeyVersion: 1 };
}

function newJob(overrides: Partial<Parameters<typeof createPhotoVaultUploadJob>[0]> = {}) {
  return createPhotoVaultUploadJob(
    {
      jobId: 'job-1',
      uid: 'alice',
      assetId: ASSET,
      pose: 'front',
      dateKey: '2026-08-15',
      takenAt: NOW - 1000,
      originalMimeType: 'image/jpeg',
      encryptedSize: 2048,
      thumbnailEncryptedSize: 256,
      encryption: encryption('YWJjZGVmZ2hpamts'),
      thumbnailEncryption: encryption('bW5vcHFyc3R1dnd4'),
      ...overrides,
    },
    NOW,
  );
}

describe('creating a job', () => {
  it('starts owing everything and due immediately', () => {
    const job = newJob();

    expect(job.stage).toBe('pending-upload');
    expect(job.state).toBe('pending');
    expect(job.uploadedFull).toBe(false);
    expect(job.uploadedThumbnail).toBe(false);
    expect(job.attempts).toBe(0);
    // The app is in the foreground the moment a job is created, which is the
    // best chance it will get.
    expect(job.nextAttemptAt).toBe(NOW);
  });

  it('derives the document id from the day and pose', () => {
    expect(newJob().documentId).toBe('2026-08-15_front');
  });

  it('files a pre-pose photo under its own asset id', () => {
    const job = newJob({ pose: undefined, dateKey: undefined });

    expect(job.documentId).toBe(ASSET);
    expect(job.pose).toBeUndefined();
    expect(job.dateKey).toBeUndefined();
  });

  it('carries no key, plaintext, URI or token', () => {
    const job = newJob();
    const serialized = JSON.stringify(job);

    // The paths are re-derived from (uid, assetId) on use — iOS moves an app's
    // container between launches, so a stored path is a latent bug as well as
    // an unnecessary disclosure.
    expect(serialized).not.toMatch(/file:|content:|\/documents\/|\/cache\//);
    expect(serialized).not.toMatch(/token|sourceUri|plaintext/i);

    // The only key-related thing stored is the key VERSION — an integer that
    // says which key the envelope was sealed with. There is no field holding
    // key material, and nothing base64-shaped long enough to be a 256-bit key.
    expect(job.encryption.vaultKeyVersion).toBe(1);
    expect(serialized).not.toMatch(/[A-Za-z0-9+/]{43}=/);
  });
});

describe('validating a stored record', () => {
  it('accepts what it just produced', () => {
    expect(isPhotoVaultUploadJob(JSON.parse(JSON.stringify(newJob())))).toBe(true);
  });

  it('rejects a record from a version this build does not understand', () => {
    const job = { ...newJob(), version: PHOTO_VAULT_UPLOAD_JOB_VERSION + 1 };

    // Guessing at an unknown shape would mean writing to Firestore from a
    // record we cannot account for.
    expect(isPhotoVaultUploadJob(job)).toBe(false);
  });

  it('rejects an asset id that is not a UUID', () => {
    // It becomes a file name and a Storage path segment.
    expect(isPhotoVaultUploadJob({ ...newJob(), assetId: '../../etc/passwd' })).toBe(false);
    expect(isPhotoVaultUploadJob({ ...newJob(), assetId: 'not-a-uuid' })).toBe(false);
  });

  it('rejects a document id that disagrees with its own day and pose', () => {
    const job = { ...newJob(), documentId: '2026-08-16_front' };

    expect(isPhotoVaultUploadJob(job)).toBe(false);
  });

  it('rejects a half-posed record', () => {
    const { dateKey: _dropped, ...missingDay } = newJob();

    expect(isPhotoVaultUploadJob(missingDay)).toBe(false);
  });

  it('rejects a pre-pose record not named after its asset', () => {
    const job = { ...newJob({ pose: undefined, dateKey: undefined }), documentId: 'elsewhere' };

    expect(isPhotoVaultUploadJob(job)).toBe(false);
  });

  it('rejects reused nonces outright', () => {
    const iv = 'YWJjZGVmZ2hpamts';
    const job = {
      ...newJob(),
      encryption: encryption(iv),
      thumbnailEncryption: encryption(iv),
    };

    // Nonce reuse under one key is the one crypto mistake that cannot be
    // tolerated, and this client never writes it.
    expect(isPhotoVaultUploadJob(job)).toBe(false);
  });

  it('rejects a stage that outruns its own checkpoints', () => {
    const job = { ...newJob(), stage: 'storage-complete' as const };

    // Trusting this would skip uploading an object that was never placed.
    expect(isPhotoVaultUploadJob(job)).toBe(false);
  });

  it('rejects non-positive sizes', () => {
    expect(isPhotoVaultUploadJob({ ...newJob(), encryptedSize: 0 })).toBe(false);
    expect(isPhotoVaultUploadJob({ ...newJob(), thumbnailEncryptedSize: -1 })).toBe(false);
  });

  it('keeps the good records and drops the bad ones', () => {
    const good = JSON.parse(JSON.stringify(newJob()));
    const alsoGood = JSON.parse(
      JSON.stringify(newJob({ jobId: 'job-2', assetId: OTHER_ASSET, pose: 'side' })),
    );

    const parsed = parsePhotoVaultUploadJobs([good, { junk: true }, alsoGood, null, 7]);

    expect(parsed.map((job) => job.jobId)).toEqual(['job-1', 'job-2']);
  });

  it('treats anything that is not an array as an empty queue', () => {
    expect(parsePhotoVaultUploadJobs(null)).toEqual([]);
    expect(parsePhotoVaultUploadJobs({ jobs: [] })).toEqual([]);
  });
});

describe('the remote stage machine', () => {
  it('does not advance until BOTH objects have landed', () => {
    let job = newJob();

    job = markAssetUploaded(job, 'thumbnail', NOW);
    // Still owes the full image; advancing here would skip uploading it.
    expect(job.stage).toBe('pending-upload');
    expect(job.uploadedThumbnail).toBe(true);
    expect(job.uploadedFull).toBe(false);

    job = markAssetUploaded(job, 'full', NOW);
    expect(job.stage).toBe('storage-complete');
  });

  it('walks pending-upload → storage-complete → metadata-complete → synced', () => {
    let job = newJob();
    job = markAssetUploaded(job, 'full', NOW);
    job = markAssetUploaded(job, 'thumbnail', NOW);
    expect(job.stage).toBe('storage-complete');

    job = markMetadataWritten(job, NOW);
    expect(job.stage).toBe('metadata-complete');

    job = markJobSynced(job, NOW);
    expect(job.stage).toBe('synced');
  });

  it('keeps the stage a failure already reached', () => {
    let job = newJob();
    job = markAssetUploaded(job, 'full', NOW);
    job = markAssetUploaded(job, 'thumbnail', NOW);

    const failed = markJobFailed(job, 'vaultMetadataCreateFailed', NOW);

    // Forgetting that both objects are already in Storage is exactly what
    // would make the retry re-upload them — and be refused.
    expect(failed.stage).toBe('storage-complete');
    expect(failed.uploadedFull).toBe(true);
    expect(failed.uploadedThumbnail).toBe(true);
  });

  it('records why it failed and when to try again', () => {
    const failed = markJobFailed(newJob(), 'vaultUploadFailed', NOW);

    expect(failed.state).toBe('failed');
    expect(failed.attempts).toBe(1);
    expect(failed.lastIssue).toBe('vaultUploadFailed');
    expect(failed.nextAttemptAt).toBe(NOW + RETRY_BASE_MS);
  });
});

describe('retry pacing', () => {
  it('backs off exponentially from the first attempt', () => {
    expect(retryDelayMs(1)).toBe(RETRY_BASE_MS);
    expect(retryDelayMs(2)).toBe(RETRY_BASE_MS * 2);
    expect(retryDelayMs(3)).toBe(RETRY_BASE_MS * 4);
  });

  it('never waits longer than the ceiling, and never zero', () => {
    expect(retryDelayMs(50)).toBe(RETRY_MAX_MS);
    // A zero delay would be a spin loop against a backend that is refusing.
    expect(retryDelayMs(0)).toBeGreaterThan(0);
    expect(retryDelayMs(-5)).toBeGreaterThan(0);
  });

  it('holds a job until its deadline', () => {
    const failed = markJobFailed(newJob(), 'vaultUploadFailed', NOW);

    expect(isJobDue(failed, NOW)).toBe(false);
    expect(isJobDue(failed, NOW + RETRY_BASE_MS)).toBe(true);
  });

  it('never hands out a job another worker is already running', () => {
    const running = markJobUploading(newJob(), NOW);

    expect(isJobDue(running, NOW + RETRY_MAX_MS)).toBe(false);
  });

  it('sleeps until the earliest deadline instead of polling', () => {
    const soon = markJobFailed(newJob(), 'vaultUploadFailed', NOW);
    const later = markJobFailed(
      markJobFailed(newJob({ jobId: 'job-2', assetId: OTHER_ASSET }), 'vaultUploadFailed', NOW),
      'vaultUploadFailed',
      NOW,
    );

    expect(nextWakeDelayMs([soon, later], NOW)).toBe(RETRY_BASE_MS);
  });

  it('reports nothing to wait for when the queue is empty or all busy', () => {
    expect(nextWakeDelayMs([], NOW)).toBeNull();
    expect(nextWakeDelayMs([markJobUploading(newJob(), NOW)], NOW)).toBeNull();
  });

  it('reports zero when something is already overdue', () => {
    expect(nextWakeDelayMs([newJob()], NOW + 5000)).toBe(0);
  });
});

describe('probing before a retry', () => {
  it('skips the probe on the very first attempt', () => {
    // A first attempt cannot have placed anything, and two extra round trips
    // to confirm that would slow the case the user is still watching.
    expect(shouldProbeRemoteState(newJob())).toBe(false);
  });

  it('probes from the second attempt onwards', () => {
    // A killed process can leave a successful upload with no checkpoint, and
    // the rules turn that invisible success into a refusal on retry.
    expect(shouldProbeRemoteState(markJobFailed(newJob(), 'vaultUploadFailed', NOW))).toBe(true);
  });
});

describe('abandoning a job', () => {
  it('keeps a job that is merely old', () => {
    expect(isJobExpired(newJob(), NOW + JOB_MAX_AGE_MS - 1)).toBe(false);
  });

  it('gives up only after a month of being unsendable', () => {
    // Reaching here means the account was signed out or offline that long.
    expect(isJobExpired(newJob(), NOW + JOB_MAX_AGE_MS + 1)).toBe(true);
  });
});

describe('immutability', () => {
  it('never mutates the job it was given', () => {
    const job = newJob();
    const snapshot: PhotoVaultUploadJob = JSON.parse(JSON.stringify(job));

    markJobUploading(job, NOW + 1);
    markAssetUploaded(job, 'full', NOW + 1);
    markMetadataWritten(job, NOW + 1);
    markJobFailed(job, 'vaultUploadFailed', NOW + 1);
    markJobSynced(job, NOW + 1);

    // The caller persists the RESULT of each transition; a hidden mutation
    // would make the stored record and the in-memory one disagree.
    expect(JSON.parse(JSON.stringify(job))).toEqual(snapshot);
  });
});
