import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeDocRef {
  path: string;
}

const transactionMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

const docMock = vi.hoisted(() => vi.fn((path: string): FakeDocRef => ({ path })));
const runTransactionMock = vi.hoisted(() =>
  vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) =>
    operation(transactionMocks),
  ),
);

vi.mock('../../lib/firebaseAdmin', () => ({
  db: { doc: docMock, runTransaction: runTransactionMock },
  auth: {},
}));

import {
  applyPromoCodeAttributionTransactionally,
  decidePromoCodeAttributionOutcome,
} from '../attributionSync';

const UID = 'firebase-uid-001';
const ARNALDO_ANDROID_OFFER = {
  monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
  annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
};
const HELLLEN_ANDROID_OFFER = {
  monthly: { basePlanId: 'monthly', offerId: 'helllen-trial-7d' },
  annual: null,
};
const ARNALDO_APPLE_OFFER = { offerCodeMonthly: null, offerCodeAnnual: null };
const HELLLEN_APPLE_OFFER = { offerCodeMonthly: 'helllen-apple-monthly', offerCodeAnnual: null };
// FASE iOS-6 — the NEW, separate correlation snapshot (distinct from
// `*_APPLE_OFFER` above, which stays whatever it always was — see
// `appleOfferCorrelation.ts`'s doc comment).
const ARNALDO_APPLE_CORRELATION = {
  monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' },
  annual: null,
};
const HELLLEN_APPLE_CORRELATION = { monthly: null, annual: null };
// FASE 1 — the new Promo SKU authorization. ARNALDO is configured for it;
// HELLLEN is deliberately NOT (`null`), proving a campaign can lack iOS
// promotional config entirely (e.g. Android-only campaigns) without
// affecting anything else.
const ARNALDO_IOS_PROMOTION = {
  offeringIdentifier: 'promo_7d',
  monthlyProductId: 'ajfit_premium_monthly_promo',
  annualProductId: 'ajfit_premium_annual_promo',
};
const HELLLEN_IOS_PROMOTION = null;
const ATTRIBUTION = {
  couponCode: 'ARNALDO',
  campaignId: 'campaign-arnaldo',
  influencerId: 'ARNALDO',
  androidOffer: ARNALDO_ANDROID_OFFER,
  appleOffer: ARNALDO_APPLE_OFFER,
  appleOfferCorrelation: ARNALDO_APPLE_CORRELATION,
  iosPromotion: ARNALDO_IOS_PROMOTION,
};

function userSnapshot(exists: boolean) {
  return { exists };
}

function redemptionSnapshot(exists: boolean, data?: Record<string, unknown>) {
  return { exists, data: () => data };
}

function findSetCall(path: string): [FakeDocRef, Record<string, unknown>, unknown?] | undefined {
  return transactionMocks.set.mock.calls.find(
    (call: unknown[]) => (call[0] as FakeDocRef).path === path,
  ) as [FakeDocRef, Record<string, unknown>, unknown?] | undefined;
}

function mockGetImplementation(userExists: boolean, redemption?: { exists: boolean; data?: Record<string, unknown> }) {
  transactionMocks.get.mockImplementation(async (ref: FakeDocRef) => {
    if (ref.path === `users/${UID}`) return userSnapshot(userExists);
    if (ref.path === `couponRedemptions/${UID}`) {
      return redemption ? redemptionSnapshot(redemption.exists, redemption.data) : redemptionSnapshot(false);
    }
    throw new Error(`unexpected ref.path in test: ${ref.path}`);
  });
}

describe('decidePromoCodeAttributionOutcome (pure)', () => {
  it('applies when there is no existing redemption record (first-ever application)', () => {
    expect(decidePromoCodeAttributionOutcome(undefined)).toEqual({ action: 'apply' });
  });

  it('applies when lockedAt is null', () => {
    expect(decidePromoCodeAttributionOutcome({ lockedAt: null })).toEqual({ action: 'apply' });
  });

  it('applies when lockedAt is undefined (defensive, pre-schema document)', () => {
    expect(decidePromoCodeAttributionOutcome({ lockedAt: undefined })).toEqual({ action: 'apply' });
  });

  it('refuses to apply when lockedAt is set', () => {
    const lockedAt = Timestamp.fromDate(new Date('2026-08-11T00:00:00.000Z'));
    expect(decidePromoCodeAttributionOutcome({ lockedAt })).toEqual({ action: 'locked' });
  });
});

describe('applyPromoCodeAttributionTransactionally', () => {
  beforeEach(() => {
    transactionMocks.get.mockReset();
    transactionMocks.set.mockReset();
    docMock.mockClear();
    runTransactionMock.mockClear();
  });

  it('returns user_not_found and writes nothing when users/{uid} does not exist', async () => {
    mockGetImplementation(false);

    const result = await applyPromoCodeAttributionTransactionally(UID, ATTRIBUTION);

    expect(result).toEqual({ status: 'user_not_found' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('Y: first application: writes couponRedemptions/{uid} (with the androidOffer snapshot) and users/{uid}.attribution together', async () => {
    mockGetImplementation(true, { exists: false });

    const result = await applyPromoCodeAttributionTransactionally(UID, ATTRIBUTION);

    expect(result).toEqual({ status: 'applied' });
    expect(transactionMocks.set).toHaveBeenCalledTimes(2);

    const redemptionCall = findSetCall(`couponRedemptions/${UID}`);
    expect(redemptionCall).toBeDefined();
    expect(redemptionCall![1]).toMatchObject({
      uid: UID,
      couponCode: 'ARNALDO',
      campaignId: 'campaign-arnaldo',
      influencerId: 'ARNALDO',
      androidOffer: ARNALDO_ANDROID_OFFER,
      appleOffer: ARNALDO_APPLE_OFFER,
      trialStartedAt: null,
      convertedAt: null,
      lockedAt: null,
    });
    // Never present: this write must never touch `subscription`.
    expect(redemptionCall![1]).not.toHaveProperty('subscription');

    const userMirrorCall = findSetCall(`users/${UID}`);
    expect(userMirrorCall).toBeDefined();
    expect(userMirrorCall![1]).toEqual({
      attribution: expect.objectContaining({
        couponCode: 'ARNALDO',
        campaignId: 'campaign-arnaldo',
        influencerId: 'ARNALDO',
      }),
    });
    // Fase 4C.3A/iOS-1 rule 6: the mirror is display-only — androidOffer/
    // appleOffer (the correlation snapshots) must NEVER leak into it.
    expect(userMirrorCall![1].attribution).not.toHaveProperty('androidOffer');
    expect(userMirrorCall![1].attribution).not.toHaveProperty('appleOffer');
    expect(userMirrorCall![1]).not.toHaveProperty('subscription');
    // merge:true — the user mirror write must never replace the whole document.
    expect(userMirrorCall![2]).toEqual({ merge: true });
  });

  it('Z: swap while pending: replaces couponCode/campaignId/influencerId/androidOffer/appleOffer atomically, but preserves createdAt', async () => {
    const originalCreatedAt = Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z'));
    mockGetImplementation(true, {
      exists: true,
      data: {
        uid: UID,
        couponCode: 'HELLLEN',
        campaignId: 'campaign-helllen',
        influencerId: 'HELLLEN',
        androidOffer: HELLLEN_ANDROID_OFFER,
        appleOffer: HELLLEN_APPLE_OFFER,
        appliedAt: originalCreatedAt,
        createdAt: originalCreatedAt,
        updatedAt: originalCreatedAt,
        trialStartedAt: null,
        convertedAt: null,
        lockedAt: null,
      },
    });

    const result = await applyPromoCodeAttributionTransactionally(UID, ATTRIBUTION);

    expect(result).toEqual({ status: 'applied' });
    const redemptionCall = findSetCall(`couponRedemptions/${UID}`);
    expect(redemptionCall![1]).toMatchObject({
      couponCode: 'ARNALDO',
      campaignId: 'campaign-arnaldo',
      influencerId: 'ARNALDO',
      androidOffer: ARNALDO_ANDROID_OFFER,
      appleOffer: ARNALDO_APPLE_OFFER,
      createdAt: originalCreatedAt,
    });
  });

  it('AA: depois de locked, nada consegue substituir — nem código, nem campanha, nem influencer, nem androidOffer, nem appleOffer', async () => {
    const lockedAt = Timestamp.fromDate(new Date('2026-08-05T00:00:00.000Z'));
    mockGetImplementation(true, {
      exists: true,
      data: {
        uid: UID,
        couponCode: 'HELLLEN',
        campaignId: 'campaign-helllen',
        influencerId: 'HELLLEN',
        androidOffer: HELLLEN_ANDROID_OFFER,
        appleOffer: HELLLEN_APPLE_OFFER,
        appliedAt: lockedAt,
        createdAt: lockedAt,
        updatedAt: lockedAt,
        trialStartedAt: lockedAt,
        convertedAt: null,
        lockedAt,
      },
    });

    const result = await applyPromoCodeAttributionTransactionally(UID, ATTRIBUTION);

    expect(result).toEqual({ status: 'locked' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('concurrency: two sequential calls against the same uid — the second sees the first already applied and refuses once locked', async () => {
    // Simulates what real Firestore transaction serialization guarantees:
    // by the time a second transaction's read observes state, it reflects
    // whatever the first transaction committed. Here that means a
    // request arriving after the attribution was already locked (by a
    // future-phase mechanism) must never be allowed to overwrite it.
    mockGetImplementation(true, { exists: false });
    const first = await applyPromoCodeAttributionTransactionally(UID, ATTRIBUTION);
    expect(first).toEqual({ status: 'applied' });

    const lockedAt = Timestamp.fromDate(new Date('2026-08-11T00:00:00.000Z'));
    mockGetImplementation(true, {
      exists: true,
      data: {
        uid: UID,
        couponCode: 'ARNALDO',
        campaignId: 'campaign-arnaldo',
        influencerId: 'ARNALDO',
        appliedAt: lockedAt,
        createdAt: lockedAt,
        updatedAt: lockedAt,
        trialStartedAt: lockedAt,
        convertedAt: null,
        lockedAt,
      },
    });
    transactionMocks.set.mockClear();

    const second = await applyPromoCodeAttributionTransactionally(UID, {
      couponCode: 'HELLLEN',
      campaignId: 'campaign-helllen',
      influencerId: 'HELLLEN',
      androidOffer: HELLLEN_ANDROID_OFFER,
      appleOffer: HELLLEN_APPLE_OFFER,
      appleOfferCorrelation: HELLLEN_APPLE_CORRELATION,
      iosPromotion: HELLLEN_IOS_PROMOTION,
    });

    expect(second).toEqual({ status: 'locked' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  // FASE iOS-1 — regression: adding appleOffer must not change what/how
  // androidOffer (or anything else Android-related) is written.
  it('FASE iOS-1 regression: androidOffer snapshot is written identically to Fase 4C.3A regardless of appleOffer content', async () => {
    mockGetImplementation(true, { exists: false });

    await applyPromoCodeAttributionTransactionally(UID, ATTRIBUTION);

    const redemptionCall = findSetCall(`couponRedemptions/${UID}`);
    expect(redemptionCall![1].androidOffer).toEqual(ARNALDO_ANDROID_OFFER);
    expect(redemptionCall![1].appleOffer).toEqual(ARNALDO_APPLE_OFFER);
  });

  // FASE 1 — the new iosPromotion snapshot follows the EXACT same pipeline
  // as androidOffer/appleOffer/appleOfferCorrelation above: written
  // verbatim on first application, replaced on a swap-while-pending, and
  // frozen forever once lockedAt is set. These tests make that explicit for
  // the new field specifically (Fase 0C §16 requirement), rather than
  // assuming it inherits the guarantee silently.
  it('FASE 1: first application snapshots iosPromotion verbatim, never into the users/{uid}.attribution mirror', async () => {
    mockGetImplementation(true, { exists: false });

    await applyPromoCodeAttributionTransactionally(UID, ATTRIBUTION);

    const redemptionCall = findSetCall(`couponRedemptions/${UID}`);
    expect(redemptionCall![1].iosPromotion).toEqual(ARNALDO_IOS_PROMOTION);

    const userMirrorCall = findSetCall(`users/${UID}`);
    expect(userMirrorCall![1].attribution).not.toHaveProperty('iosPromotion');
  });

  it('FASE 1: swap while pending replaces iosPromotion atomically along with the other snapshot fields', async () => {
    const originalCreatedAt = Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z'));
    mockGetImplementation(true, {
      exists: true,
      data: {
        uid: UID,
        couponCode: 'HELLLEN',
        campaignId: 'campaign-helllen',
        influencerId: 'HELLLEN',
        androidOffer: HELLLEN_ANDROID_OFFER,
        appleOffer: HELLLEN_APPLE_OFFER,
        appleOfferCorrelation: HELLLEN_APPLE_CORRELATION,
        iosPromotion: HELLLEN_IOS_PROMOTION,
        appliedAt: originalCreatedAt,
        createdAt: originalCreatedAt,
        updatedAt: originalCreatedAt,
        trialStartedAt: null,
        convertedAt: null,
        lockedAt: null,
      },
    });

    const result = await applyPromoCodeAttributionTransactionally(UID, ATTRIBUTION);

    expect(result).toEqual({ status: 'applied' });
    const redemptionCall = findSetCall(`couponRedemptions/${UID}`);
    expect(redemptionCall![1].iosPromotion).toEqual(ARNALDO_IOS_PROMOTION);
  });

  it('FASE 1: revalidating the SAME code while pending refreshes iosPromotion from the current catalog read — the campaign catalog, not this transaction, owns "current"', async () => {
    // `validatePromoCode.ts` always computes the snapshot from a FRESH
    // catalog read before calling this function — so if an admin edited
    // `promoCodes/ARNALDO.iosPromotion` between two applications of the
    // same code, the second application legitimately carries the NEW value
    // here. This is the existing "swap" semantics (docs comment on
    // `applyPromoCodeAttributionTransactionally`) applied unchanged to the
    // new field — the real immutability guarantee is the one proven below:
    // once lockedAt is set, no further read/apply can change it at all.
    const originalCreatedAt = Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z'));
    mockGetImplementation(true, {
      exists: true,
      data: {
        uid: UID,
        couponCode: 'ARNALDO',
        campaignId: 'campaign-arnaldo',
        influencerId: 'ARNALDO',
        androidOffer: ARNALDO_ANDROID_OFFER,
        appleOffer: ARNALDO_APPLE_OFFER,
        appleOfferCorrelation: ARNALDO_APPLE_CORRELATION,
        iosPromotion: { offeringIdentifier: 'promo_7d_old', monthlyProductId: 'old_monthly', annualProductId: 'old_annual' },
        appliedAt: originalCreatedAt,
        createdAt: originalCreatedAt,
        updatedAt: originalCreatedAt,
        trialStartedAt: null,
        convertedAt: null,
        lockedAt: null,
      },
    });

    await applyPromoCodeAttributionTransactionally(UID, ATTRIBUTION);

    const redemptionCall = findSetCall(`couponRedemptions/${UID}`);
    expect(redemptionCall![1].iosPromotion).toEqual(ARNALDO_IOS_PROMOTION);
  });

  it('FASE 1: once locked, iosPromotion is frozen — a revalidation with a mutated catalog value never overwrites the stored snapshot', async () => {
    const lockedAt = Timestamp.fromDate(new Date('2026-08-05T00:00:00.000Z'));
    mockGetImplementation(true, {
      exists: true,
      data: {
        uid: UID,
        couponCode: 'ARNALDO',
        campaignId: 'campaign-arnaldo',
        influencerId: 'ARNALDO',
        androidOffer: ARNALDO_ANDROID_OFFER,
        appleOffer: ARNALDO_APPLE_OFFER,
        appleOfferCorrelation: ARNALDO_APPLE_CORRELATION,
        iosPromotion: ARNALDO_IOS_PROMOTION,
        appliedAt: lockedAt,
        createdAt: lockedAt,
        updatedAt: lockedAt,
        trialStartedAt: lockedAt,
        convertedAt: null,
        lockedAt,
      },
    });

    // The catalog was edited AFTER locking — a differently-shaped
    // `iosPromotion` is passed in, simulating validatePromoCode.ts reading
    // the mutated `promoCodes/ARNALDO` document.
    const mutatedAttribution = {
      ...ATTRIBUTION,
      iosPromotion: {
        offeringIdentifier: 'promo_7d_mutated',
        monthlyProductId: 'mutated_monthly',
        annualProductId: 'mutated_annual',
      },
    };

    const result = await applyPromoCodeAttributionTransactionally(UID, mutatedAttribution);

    expect(result).toEqual({ status: 'locked' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('FASE 1: a campaign with no iOS promotional configuration snapshots iosPromotion: null — never fabricated', async () => {
    mockGetImplementation(true, { exists: false });

    await applyPromoCodeAttributionTransactionally(UID, { ...ATTRIBUTION, iosPromotion: null });

    const redemptionCall = findSetCall(`couponRedemptions/${UID}`);
    expect(redemptionCall![1].iosPromotion).toBeNull();
  });
});
