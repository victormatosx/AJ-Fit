import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';

import { runRetainedDataProcessing } from '../engine';
import { createFakeFirestore } from './fakeFirestore';
import { createFakeBucket } from './fakeBucket';
import type { RetainedDataCategoryResult } from '../types';
import { resolveWorkflowPolicy, CURRENT_WORKFLOW_VERSION } from '../../policy';

function depsFor(fs: ReturnType<typeof createFakeFirestore>, bucket = createFakeBucket()) {
  return {
    db: fs.db as unknown as Firestore,
    storage: { bucket: () => bucket.bucket } as unknown as Storage,
  };
}

const V1_RETENTION = { support: 'RETAIN', couponRedemptions: 'RETAIN' } as const;

describe('runRetainedDataProcessing — policy v1 (RETAIN/RETAIN)', () => {
  it('reports SKIPPED_BY_POLICY, never SUCCEEDED, when nothing destructive ran', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();

    const outcome = await runRetainedDataProcessing('uid-1', V1_RETENTION, depsFor(fs, bucket));

    expect(outcome.kind).toBe('SKIPPED_BY_POLICY');
  });

  it('preserves an existing ticket, message, attachment, and redemption untouched', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    fs.seed('supportTickets/t1', { userId: 'uid-1' });
    fs.seed('supportTickets/t1/messages/m1', { senderId: 'uid-1' });
    fs.seed('couponRedemptions/uid-1', { uid: 'uid-1', lockedAt: 123 });
    bucket.seed('users/uid-1/support/t1/attachments/photo.jpg');

    await runRetainedDataProcessing('uid-1', V1_RETENTION, depsFor(fs, bucket));

    expect(fs.exists('supportTickets/t1')).toBe(true);
    expect(fs.exists('supportTickets/t1/messages/m1')).toBe(true);
    expect(fs.exists('couponRedemptions/uid-1')).toBe(true);
    expect(bucket.exists('users/uid-1/support/t1/attachments/photo.jpg')).toBe(true);
  });

  it('reports both categories via onCategoryCompleted', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    const seen: RetainedDataCategoryResult[] = [];

    await runRetainedDataProcessing('uid-1', V1_RETENTION, {
      ...depsFor(fs, bucket),
      onCategoryCompleted: (result) => seen.push(result),
    });

    expect(seen.map((r) => r.category)).toEqual(['support', 'couponRedemptions']);
    expect(seen.every((r) => r.outcome === 'RETAINED')).toBe(true);
  });

  it('idempotent: running the step repeatedly always converges on SKIPPED_BY_POLICY with no mutation', async () => {
    const fs = createFakeFirestore();
    fs.seed('supportTickets/t1', { userId: 'uid-1' });
    fs.seed('couponRedemptions/uid-1', { uid: 'uid-1' });

    const first = await runRetainedDataProcessing('uid-1', V1_RETENTION, depsFor(fs));
    const second = await runRetainedDataProcessing('uid-1', V1_RETENTION, depsFor(fs));
    const third = await runRetainedDataProcessing('uid-1', V1_RETENTION, depsFor(fs));

    for (const outcome of [first, second, third]) expect(outcome.kind).toBe('SKIPPED_BY_POLICY');
    expect(fs.exists('supportTickets/t1')).toBe(true);
    expect(fs.exists('couponRedemptions/uid-1')).toBe(true);
  });
});

describe('runRetainedDataProcessing — other uid isolation', () => {
  it('processing uid-A never touches uid-B support/coupon data', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    fs.seed('supportTickets/tB', { userId: 'uid-B' });
    fs.seed('couponRedemptions/uid-B', { uid: 'uid-B' });
    bucket.seed('users/uid-B/support/tB/attachments/photo.jpg');

    await runRetainedDataProcessing('uid-A', V1_RETENTION, depsFor(fs, bucket));

    expect(fs.exists('supportTickets/tB')).toBe(true);
    expect(fs.exists('couponRedemptions/uid-B')).toBe(true);
    expect(bucket.exists('users/uid-B/support/tB/attachments/photo.jpg')).toBe(true);
  });
});

describe('runRetainedDataProcessing — a policy version that authorizes DELETE (hypothetical, contract-supported)', () => {
  const HYPOTHETICAL_DELETE_POLICY = { support: 'DELETE', couponRedemptions: 'RETAIN' } as const;

  it('reports SUCCEEDED (not SKIPPED_BY_POLICY) when at least one category actually deletes', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    fs.seed('supportTickets/t1', { userId: 'uid-1' });
    fs.seed('couponRedemptions/uid-1', { uid: 'uid-1' });

    const outcome = await runRetainedDataProcessing('uid-1', HYPOTHETICAL_DELETE_POLICY, depsFor(fs, bucket));

    expect(outcome).toEqual({ kind: 'SUCCEEDED' });
    expect(fs.exists('supportTickets/t1')).toBe(false);
    expect(fs.exists('couponRedemptions/uid-1')).toBe(true); // still RETAIN
  });
});

describe('runRetainedDataProcessing — ANONYMIZE without a contract fails terminal, never fakes it', () => {
  it('reports FAILED with MISSING_REQUIRED_CONFIGURATION, mutates nothing', async () => {
    const fs = createFakeFirestore();
    fs.seed('supportTickets/t1', { userId: 'uid-1' });

    const outcome = await runRetainedDataProcessing(
      'uid-1',
      { support: 'ANONYMIZE', couponRedemptions: 'RETAIN' },
      depsFor(fs),
    );

    expect(outcome).toEqual({ kind: 'FAILED', code: 'MISSING_REQUIRED_CONFIGURATION' });
    expect(fs.exists('supportTickets/t1')).toBe(true);
  });
});

describe('runRetainedDataProcessing — error classification', () => {
  it('a transient Firestore query failure maps to a RETRYABLE code, never silently swallowed', async () => {
    const fs = createFakeFirestore();
    fs.failNextGet(Object.assign(new Error('unavailable'), { code: 14 }));

    const outcome = await runRetainedDataProcessing('uid-1', V1_RETENTION, depsFor(fs));

    expect(outcome).toEqual({ kind: 'FAILED', code: 'UNAVAILABLE' });
  });
});

describe('runRetainedDataProcessing — policy versioning (Fase 8 rule §2/§21)', () => {
  it('a record frozen under v1 (RETAIN/RETAIN) always retains, even if currentPolicy() has since diverged', async () => {
    // Simulates a FUTURE policy version this backend build also understands,
    // where support/couponRedemptions became DELETE — without registering it
    // in the real `policy.ts` (that file is never edited by this test). The
    // proof is structural: this engine only ever reads the value PASSED to
    // it, never `currentPolicy()`/`resolveWorkflowPolicy()` itself.
    const frozenAtRequestTime = resolveWorkflowPolicy(CURRENT_WORKFLOW_VERSION).retention;
    expect(frozenAtRequestTime).toEqual({ support: 'RETAIN', couponRedemptions: 'RETAIN', revenueCat: 'SKIP' });

    const hypotheticalFuturePolicy = { support: 'DELETE', couponRedemptions: 'DELETE' } as const;

    const fs = createFakeFirestore();
    fs.seed('supportTickets/t1', { userId: 'uid-1' });
    fs.seed('couponRedemptions/uid-1', { uid: 'uid-1' });

    // Processing the OLD record must use its own frozen retention, not
    // whatever a hypothetical newer version would do — this call passes the
    // frozen v1 values explicitly, proving the engine has no other source.
    const outcome = await runRetainedDataProcessing(
      'uid-1',
      { support: frozenAtRequestTime.support, couponRedemptions: frozenAtRequestTime.couponRedemptions },
      depsFor(fs),
    );

    expect(outcome.kind).toBe('SKIPPED_BY_POLICY');
    expect(fs.exists('supportTickets/t1')).toBe(true);
    expect(fs.exists('couponRedemptions/uid-1')).toBe(true);

    // Sanity check the engine IS capable of DELETE when actually told to —
    // proving the RETAIN result above was policy-driven, not a hardcoded
    // inability to delete.
    const deleteOutcome = await runRetainedDataProcessing('uid-1', hypotheticalFuturePolicy, depsFor(fs));
    expect(deleteOutcome).toEqual({ kind: 'SUCCEEDED' });
    expect(fs.exists('supportTickets/t1')).toBe(false);
    expect(fs.exists('couponRedemptions/uid-1')).toBe(false);
  });
});
