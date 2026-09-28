import { describe, expect, it } from 'vitest';
import type { Storage } from 'firebase-admin/storage';

import { runStorageCleanup } from '../engine';
import { createFakeBucket } from './fakeBucket';
import type { StorageResourceCleanupResult } from '../types';

function storageFor(harness: ReturnType<typeof createFakeBucket>): Storage {
  return { bucket: () => harness.bucket } as unknown as Storage;
}

function seedFullUser(harness: ReturnType<typeof createFakeBucket>, uid: string) {
  harness.seed(`users/${uid}/profile/avatar`);
  harness.seed(`users/${uid}/progressPhotos/p1.enc`);
  harness.seed(`users/${uid}/progressPhotos/p1.thumb.enc`);
  harness.seed(`users/${uid}/progressPhotos/p2.enc`);
  harness.seed(`users/${uid}/support-v2/staged/upload-1`);
}

describe('runStorageCleanup — happy path', () => {
  it('an empty user succeeds', async () => {
    const harness = createFakeBucket();
    await expect(runStorageCleanup('uid-1', { storage: storageFor(harness) })).resolves.toEqual({
      kind: 'SUCCEEDED',
    });
  });

  it('a fully populated user has avatar and progress photos removed', async () => {
    const harness = createFakeBucket();
    seedFullUser(harness, 'uid-1');

    const outcome = await runStorageCleanup('uid-1', { storage: storageFor(harness) });

    expect(outcome).toEqual({ kind: 'SUCCEEDED' });
    expect(harness.listUnder('users/uid-1/profile/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-1/progressPhotos/')).toHaveLength(0);
  });
});

describe('runStorageCleanup — support attachments retained (Fase 7 §48, obrigatório enquanto policy v1)', () => {
  it('deletable objects are gone, support attachment survives', async () => {
    const harness = createFakeBucket();
    seedFullUser(harness, 'uid-1');

    await runStorageCleanup('uid-1', { storage: storageFor(harness) });

    expect(harness.exists('users/uid-1/support-v2/staged/upload-1')).toBe(true);
    expect(harness.exists('users/uid-1/profile/avatar')).toBe(false);
    expect(harness.exists('users/uid-1/progressPhotos/p1.enc')).toBe(false);
  });
});

describe('runStorageCleanup — orphan independence from Firestore (Fase 7 §46/§47/§55/§56)', () => {
  it('deletes an orphaned Storage object with no corresponding Firestore metadata (this engine never reads Firestore at all)', async () => {
    const harness = createFakeBucket();
    harness.seed('users/uid-1/progressPhotos/truly-orphaned.enc');

    const outcome = await runStorageCleanup('uid-1', { storage: storageFor(harness) });

    expect(outcome).toEqual({ kind: 'SUCCEEDED' });
    expect(harness.exists('users/uid-1/progressPhotos/truly-orphaned.enc')).toBe(false);
  });

  it('succeeds identically when Firestore metadata was already deleted first (Fase 6 already ran) or never runs at all', async () => {
    // No Firestore fake is even constructed in this test file — the engine
    // has no dependency to inject. This IS the independence proof: there is
    // no code path here that could reach Firestore even if it wanted to.
    const harness = createFakeBucket();
    seedFullUser(harness, 'uid-1');
    await expect(runStorageCleanup('uid-1', { storage: storageFor(harness) })).resolves.toEqual({
      kind: 'SUCCEEDED',
    });
  });
});

describe('runStorageCleanup — Vault ciphertext (Fase 7 §39)', () => {
  it('removes progress-photo ciphertext regardless of whether the Vault key was already destroyed', async () => {
    const harness = createFakeBucket();
    harness.seed('users/uid-1/progressPhotos/p1.enc'); // ciphertext, unreadable-or-not is irrelevant here
    harness.seed('users/uid-1/progressPhotos/p1.thumb.enc');

    await runStorageCleanup('uid-1', { storage: storageFor(harness) });

    expect(harness.listUnder('users/uid-1/progressPhotos/')).toHaveLength(0);
  });
});

describe('runStorageCleanup — scale', () => {
  it('handles hundreds of progress-photo objects across multiple pages', async () => {
    const harness = createFakeBucket();
    for (let i = 0; i < 600; i++) {
      harness.seed(`users/uid-1/progressPhotos/p${i}.enc`);
    }

    await expect(runStorageCleanup('uid-1', { storage: storageFor(harness) })).resolves.toEqual({
      kind: 'SUCCEEDED',
    });
    expect(harness.listUnder('users/uid-1/progressPhotos/')).toHaveLength(0);
  });
});

describe('runStorageCleanup — ordering/observability', () => {
  it('reports avatar before progressPhotos', async () => {
    const harness = createFakeBucket();
    seedFullUser(harness, 'uid-1');
    const order: string[] = [];

    await runStorageCleanup('uid-1', {
      storage: storageFor(harness),
      onResourceCompleted: (result: StorageResourceCleanupResult) => order.push(result.resource),
    });

    expect(order).toEqual(['avatar', 'progressPhotos']);
  });
});

describe('runStorageCleanup — retry after partial failure', () => {
  it('a failure on avatar leaves progressPhotos untouched, and a retry finishes both', async () => {
    const harness = createFakeBucket();
    seedFullUser(harness, 'uid-1');

    harness.failNextGetFiles(new Error('boom'));
    const first = await runStorageCleanup('uid-1', { storage: storageFor(harness) });
    expect(first.kind).toBe('FAILED');
    expect(harness.exists('users/uid-1/profile/avatar')).toBe(true);
    expect(harness.exists('users/uid-1/progressPhotos/p1.enc')).toBe(true);

    const retry = await runStorageCleanup('uid-1', { storage: storageFor(harness) });
    expect(retry).toEqual({ kind: 'SUCCEEDED' });
    expect(harness.exists('users/uid-1/profile/avatar')).toBe(false);
    expect(harness.exists('users/uid-1/progressPhotos/p1.enc')).toBe(false);
  });
});

describe('runStorageCleanup — concurrency', () => {
  it('two concurrent cleanups for the same uid both converge on a fully-cleaned state', async () => {
    const harness = createFakeBucket();
    seedFullUser(harness, 'uid-1');

    const [a, b] = await Promise.all([
      runStorageCleanup('uid-1', { storage: storageFor(harness) }),
      runStorageCleanup('uid-1', { storage: storageFor(harness) }),
    ]);

    expect(a.kind).toBe('SUCCEEDED');
    expect(b.kind).toBe('SUCCEEDED');
    expect(harness.listUnder('users/uid-1/progressPhotos/')).toHaveLength(0);
  });
});

describe('runStorageCleanup — other uid isolation', () => {
  it('cleaning up one uid leaves a fully populated other uid 100% intact', async () => {
    const harness = createFakeBucket();
    seedFullUser(harness, 'uid-A');
    seedFullUser(harness, 'uid-B');

    await runStorageCleanup('uid-A', { storage: storageFor(harness) });

    expect(harness.listUnder('users/uid-A/progressPhotos/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-B/progressPhotos/')).toHaveLength(3);
    expect(harness.exists('users/uid-B/profile/avatar')).toBe(true);
    expect(harness.exists('users/uid-B/support-v2/staged/upload-1')).toBe(true);
  });
});
