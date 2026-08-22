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

function seedTicket(
  fsHarness: ReturnType<typeof createFakeFirestore>,
  ticketId: string,
  uid: string,
  messageIds: string[] = [],
) {
  fsHarness.seed(`supportTickets/${ticketId}`, { userId: uid });
  for (const messageId of messageIds) {
    fsHarness.seed(`supportTickets/${ticketId}/messages/${messageId}`, { senderId: uid });
  }
}

describe('processSupportRetention — RETAIN (policy v1)', () => {
  it('an owner with no tickets reports RETAINED, resourceCount 0', async () => {
    const fs = createFakeFirestore();
    const result = await processSupportRetention('uid-1', 'RETAIN', depsFor(fs));
    expect(result).toEqual({ category: 'support', action: 'RETAIN', outcome: 'RETAINED', resourceCount: 0 });
  });

  it('never mutates an existing ticket/message/attachment', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    seedTicket(fs, 't1', 'uid-1', ['m1']);
    bucket.seed('users/uid-1/support/t1/attachments/photo.jpg');

    const result = await processSupportRetention('uid-1', 'RETAIN', depsFor(fs, bucket));

    expect(result).toEqual({ category: 'support', action: 'RETAIN', outcome: 'RETAINED', resourceCount: 1 });
    expect(fs.exists('supportTickets/t1')).toBe(true);
    expect(fs.exists('supportTickets/t1/messages/m1')).toBe(true);
    expect(bucket.exists('users/uid-1/support/t1/attachments/photo.jpg')).toBe(true);
  });

  it('counts multiple tickets owned by the uid, ignoring tickets owned by another uid', async () => {
    const fs = createFakeFirestore();
    seedTicket(fs, 't1', 'uid-A');
    seedTicket(fs, 't2', 'uid-A');
    seedTicket(fs, 't3', 'uid-B');

    const result = await processSupportRetention('uid-A', 'RETAIN', depsFor(fs));
    expect(result.resourceCount).toBe(2);
  });
});

describe('processSupportRetention — ANONYMIZE (no contract, rule §8/§11)', () => {
  it('throws UnsupportedRetentionActionError instead of faking anonymization', async () => {
    const fs = createFakeFirestore();
    seedTicket(fs, 't1', 'uid-1');

    await expect(processSupportRetention('uid-1', 'ANONYMIZE', depsFor(fs))).rejects.toBeInstanceOf(
      UnsupportedRetentionActionError,
    );
    // Nothing was touched by the rejected attempt.
    expect(fs.exists('supportTickets/t1')).toBe(true);
  });
});

describe('processSupportRetention — DELETE (contract-supported, not used by policy v1)', () => {
  it('deletes ticket, messages, and Storage attachments together', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    seedTicket(fs, 't1', 'uid-1', ['m1', 'm2']);
    bucket.seed('users/uid-1/support/t1/attachments/photo.jpg');

    const result = await processSupportRetention('uid-1', 'DELETE', depsFor(fs, bucket));

    expect(result).toEqual({ category: 'support', action: 'DELETE', outcome: 'DELETED', resourceCount: 1 });
    expect(fs.exists('supportTickets/t1')).toBe(false);
    expect(fs.exists('supportTickets/t1/messages/m1')).toBe(false);
    expect(fs.exists('supportTickets/t1/messages/m2')).toBe(false);
    expect(bucket.exists('users/uid-1/support/t1/attachments/photo.jpg')).toBe(false);
  });

  it('a uid with nothing owned is ALREADY_ABSENT, not an error', async () => {
    const fs = createFakeFirestore();
    const result = await processSupportRetention('uid-1', 'DELETE', depsFor(fs));
    expect(result).toEqual({ category: 'support', action: 'DELETE', outcome: 'ALREADY_ABSENT', resourceCount: 0 });
  });

  it('never deletes another uid\'s ticket', async () => {
    const fs = createFakeFirestore();
    seedTicket(fs, 't1', 'uid-A');
    seedTicket(fs, 't2', 'uid-B');

    await processSupportRetention('uid-A', 'DELETE', depsFor(fs));

    expect(fs.exists('supportTickets/t1')).toBe(false);
    expect(fs.exists('supportTickets/t2')).toBe(true);
  });

  it('never deletes another uid\'s attachment prefix', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    seedTicket(fs, 't1', 'uid-A');
    bucket.seed('users/uid-A/support/t1/attachments/a.jpg');
    bucket.seed('users/uid-B/support/t9/attachments/b.jpg');

    await processSupportRetention('uid-A', 'DELETE', depsFor(fs, bucket));

    expect(bucket.exists('users/uid-A/support/t1/attachments/a.jpg')).toBe(false);
    expect(bucket.exists('users/uid-B/support/t9/attachments/b.jpg')).toBe(true);
  });

  it('idempotent: running DELETE twice converges, second run is ALREADY_ABSENT', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    seedTicket(fs, 't1', 'uid-1');
    bucket.seed('users/uid-1/support/t1/attachments/photo.jpg');

    await processSupportRetention('uid-1', 'DELETE', depsFor(fs, bucket));
    const second = await processSupportRetention('uid-1', 'DELETE', depsFor(fs, bucket));

    expect(second).toEqual({ category: 'support', action: 'DELETE', outcome: 'ALREADY_ABSENT', resourceCount: 0 });
  });

  it('finishes a leftover attachment prefix even when the ticket doc is already gone (retry after partial failure)', async () => {
    const fs = createFakeFirestore();
    const bucket = createFakeBucket();
    // Simulates: a prior attempt deleted the ticket doc but was interrupted
    // before the Storage prefix delete ran.
    bucket.seed('users/uid-1/support/t1/attachments/photo.jpg');

    const result = await processSupportRetention('uid-1', 'DELETE', depsFor(fs, bucket));

    expect(result.outcome).toBe('ALREADY_ABSENT');
    expect(bucket.exists('users/uid-1/support/t1/attachments/photo.jpg')).toBe(false);
  });
});
