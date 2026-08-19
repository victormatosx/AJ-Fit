/**
 * Coupon/attribution redemptions — Fase 8 §13/§14/§15/§16/§17.
 *
 * Schema audited from `functions/src/attribution/types.ts`'s
 * `CouponRedemption` and `constants.ts`'s `couponRedemptionDocPath` — never
 * invented. Doc ID IS the uid (`couponRedemptions/{uid}`), so ownership is
 * structural (a direct `get()` by path), not a query.
 *
 * `lockedAt` (non-null once the store confirms a real trial/purchase — see
 * `attributionSync.ts`'s `applyAttributionRevenueCatEvent`) is the
 * antifraud/commission-attribution latch: once set, `couponCode`/
 * `androidOffer`/`iosPromotion`/`influencerId`/`campaignId` become
 * immutable evidence of what was actually paid for and by whom, for
 * influencer commission accounting. Fase 8 rule §17: this module never
 * inspects or special-cases `lockedAt` — RETAIN preserves the whole
 * document (locked or not) exactly as-is; DELETE (not used by policy v1)
 * would remove it regardless of lock state, since a deletion request always
 * takes priority over a still-live commission record once product/legal
 * actually authorizes DELETE for this category — that authorization is
 * Fase 0 territory, not decided here.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { RetentionAction } from '../types';
import { UnsupportedRetentionActionError } from './types';
import type { RetainedDataCategoryResult } from './types';

const COUPON_REDEMPTIONS_COLLECTION = 'couponRedemptions';

export async function processCouponRedemptionsRetention(
  uid: string,
  action: RetentionAction,
  deps: { db: Firestore },
): Promise<RetainedDataCategoryResult> {
  const { db } = deps;
  const ref = db.collection(COUPON_REDEMPTIONS_COLLECTION).doc(uid);

  if (action === 'ANONYMIZE') {
    throw new UnsupportedRetentionActionError('couponRedemptions', action);
  }

  if (action === 'DELETE') {
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return { category: 'couponRedemptions', action, outcome: 'ALREADY_ABSENT', resourceCount: 0 };
    }
    await ref.delete();
    return { category: 'couponRedemptions', action, outcome: 'DELETED', resourceCount: 1 };
  }

  // RETAIN / SKIP: no mutation, observability read only — never inspects
  // `lockedAt` (see doc comment above).
  const snapshot = await ref.get();
  return {
    category: 'couponRedemptions',
    action,
    outcome: 'RETAINED',
    resourceCount: snapshot.exists ? 1 : 0,
  };
}
