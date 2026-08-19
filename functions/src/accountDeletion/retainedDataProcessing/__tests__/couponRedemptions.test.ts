import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

import { processCouponRedemptionsRetention } from '../couponRedemptions';
import { UnsupportedRetentionActionError } from '../types';
import { createFakeFirestore } from './fakeFirestore';

function dbFor(fsHarness: ReturnType<typeof createFakeFirestore>): Firestore {
  return fsHarness.db as unknown as Firestore;
}

describe('processCouponRedemptionsRetention — RETAIN (policy v1)', () => {
  it('no redemption for this uid: RETAINED, resourceCount 0', async () => {
    const fs = createFakeFirestore();
    const result = await processCouponRedemptionsRetention('uid-1', 'RETAIN', { db: dbFor(fs) });
    expect(result).toEqual({ category: 'couponRedemptions', action: 'RETAIN', outcome: 'RETAINED', resourceCount: 0 });
  });

  it('never mutates an existing redemption, locked or not', async () => {
    const fs = createFakeFirestore();
    fs.seed('couponRedemptions/uid-1', { uid: 'uid-1', couponCode: 'ARNALDO10', lockedAt: null });

    const result = await processCouponRedemptionsRetention('uid-1', 'RETAIN', { db: dbFor(fs) });

    expect(result).toEqual({ category: 'couponRedemptions', action: 'RETAIN', outcome: 'RETAINED', resourceCount: 1 });
    expect(fs.exists('couponRedemptions/uid-1')).toBe(true);
  });

  it('a LOCKED redemption (commission-confirmed) is preserved identically to an unlocked one', async () => {
    const fs = createFakeFirestore();
    fs.seed('couponRedemptions/uid-1', {
      uid: 'uid-1',
      couponCode: 'HELLLEN20',
      influencerId: 'inf-1',
      lockedAt: 1_700_000_000_000,
    });

    await processCouponRedemptionsRetention('uid-1', 'RETAIN', { db: dbFor(fs) });

    expect(fs.exists('couponRedemptions/uid-1')).toBe(true);
  });

  it("never touches another uid's redemption", async () => {
    const fs = createFakeFirestore();
    fs.seed('couponRedemptions/uid-A', { uid: 'uid-A' });
    fs.seed('couponRedemptions/uid-B', { uid: 'uid-B' });

    await processCouponRedemptionsRetention('uid-A', 'RETAIN', { db: dbFor(fs) });

    expect(fs.exists('couponRedemptions/uid-B')).toBe(true);
  });
});

describe('processCouponRedemptionsRetention — ANONYMIZE (no contract, rule §16)', () => {
  it('throws UnsupportedRetentionActionError instead of faking anonymization', async () => {
    const fs = createFakeFirestore();
    fs.seed('couponRedemptions/uid-1', { uid: 'uid-1' });

    await expect(
      processCouponRedemptionsRetention('uid-1', 'ANONYMIZE', { db: dbFor(fs) }),
    ).rejects.toBeInstanceOf(UnsupportedRetentionActionError);
    expect(fs.exists('couponRedemptions/uid-1')).toBe(true);
  });
});

describe('processCouponRedemptionsRetention — DELETE (contract-supported, not used by policy v1)', () => {
  it('deletes the single owned redemption document', async () => {
    const fs = createFakeFirestore();
    fs.seed('couponRedemptions/uid-1', { uid: 'uid-1' });

    const result = await processCouponRedemptionsRetention('uid-1', 'DELETE', { db: dbFor(fs) });

    expect(result).toEqual({ category: 'couponRedemptions', action: 'DELETE', outcome: 'DELETED', resourceCount: 1 });
    expect(fs.exists('couponRedemptions/uid-1')).toBe(false);
  });

  it('missing redemption is ALREADY_ABSENT, never an error', async () => {
    const fs = createFakeFirestore();
    const result = await processCouponRedemptionsRetention('uid-1', 'DELETE', { db: dbFor(fs) });
    expect(result).toEqual({ category: 'couponRedemptions', action: 'DELETE', outcome: 'ALREADY_ABSENT', resourceCount: 0 });
  });

  it('idempotent retry after full deletion', async () => {
    const fs = createFakeFirestore();
    fs.seed('couponRedemptions/uid-1', { uid: 'uid-1' });

    await processCouponRedemptionsRetention('uid-1', 'DELETE', { db: dbFor(fs) });
    const second = await processCouponRedemptionsRetention('uid-1', 'DELETE', { db: dbFor(fs) });

    expect(second).toEqual({ category: 'couponRedemptions', action: 'DELETE', outcome: 'ALREADY_ABSENT', resourceCount: 0 });
  });

  it("never deletes another uid's redemption", async () => {
    const fs = createFakeFirestore();
    fs.seed('couponRedemptions/uid-A', { uid: 'uid-A' });
    fs.seed('couponRedemptions/uid-B', { uid: 'uid-B' });

    await processCouponRedemptionsRetention('uid-A', 'DELETE', { db: dbFor(fs) });

    expect(fs.exists('couponRedemptions/uid-A')).toBe(false);
    expect(fs.exists('couponRedemptions/uid-B')).toBe(true);
  });
});
