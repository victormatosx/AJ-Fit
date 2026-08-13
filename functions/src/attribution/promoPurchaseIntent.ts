import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/firebaseAdmin';
import { logFunctionError } from '../lib/logger';
import {
  PROMO_PURCHASE_INTENT_TTL_MS,
  couponRedemptionDocPath,
  type PromoPurchasePlan,
} from './constants';
import { isValidIOSPromotionConfig } from './promoCodeCatalog';
import type { IOSPromotionConfig, PromoPurchaseIntent } from './types';

const SCOPE = 'attribution:promoPurchaseIntent';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFieldSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** Strict defensive parser for the server-owned nested intent. */
export function parseStoredPromoPurchaseIntent(value: unknown): PromoPurchaseIntent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const expectedKeys = [
    'campaignId',
    'plan',
    'expectedProductId',
    'offeringIdentifier',
    'status',
    'createdAt',
    'updatedAt',
    'expiresAt',
  ];
  const keys = Object.keys(v);
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) {
    return null;
  }
  if (
    !isNonEmptyString(v.campaignId) ||
    (v.plan !== 'monthly' && v.plan !== 'annual') ||
    !isNonEmptyString(v.expectedProductId) ||
    !isNonEmptyString(v.offeringIdentifier) ||
    v.status !== 'purchase_pending' ||
    !(v.createdAt instanceof Timestamp) ||
    !(v.updatedAt instanceof Timestamp) ||
    !(v.expiresAt instanceof Timestamp)
  ) {
    return null;
  }
  return {
    campaignId: v.campaignId,
    plan: v.plan,
    expectedProductId: v.expectedProductId,
    offeringIdentifier: v.offeringIdentifier,
    status: v.status,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    expiresAt: v.expiresAt,
  };
}

export function isPromoPurchaseIntentActiveAt(
  intent: PromoPurchaseIntent,
  now: Timestamp,
): boolean {
  return intent.status === 'purchase_pending' && intent.expiresAt.toMillis() > now.toMillis();
}

interface DesiredPromoPurchaseIntent {
  campaignId: string;
  plan: PromoPurchasePlan;
  expectedProductId: string;
  offeringIdentifier: string;
}

export type PromoPurchaseIntentDecision =
  | { action: 'create' }
  | { action: 'reuse'; intent: PromoPurchaseIntent }
  | { action: 'conflict' };

/** Pure idempotency/conflict decision, evaluated from one transactional read. */
export function decidePromoPurchaseIntent(
  existing: PromoPurchaseIntent | undefined,
  desired: DesiredPromoPurchaseIntent,
  now: Timestamp,
): PromoPurchaseIntentDecision {
  if (!existing || !isPromoPurchaseIntentActiveAt(existing, now)) return { action: 'create' };

  if (
    existing.campaignId === desired.campaignId &&
    existing.plan === desired.plan &&
    existing.expectedProductId === desired.expectedProductId &&
    existing.offeringIdentifier === desired.offeringIdentifier
  ) {
    return { action: 'reuse', intent: existing };
  }

  return { action: 'conflict' };
}

export type AuthorizePromoPurchaseTransactionResult =
  | { status: 'authorized'; intent: PromoPurchaseIntent; reused: boolean }
  | { status: 'no_redemption' }
  | { status: 'invalid_redemption' }
  | { status: 'ios_promotion_unavailable' }
  | { status: 'redemption_consumed' }
  | { status: 'intent_conflict' };

/**
 * Reads, validates, decides, and writes against `couponRedemptions/{uid}` in
 * one Firestore transaction. A concurrent transaction for the same uid must
 * re-read after Firestore retries, so only one non-expired intent can win.
 */
export async function authorizePromoPurchaseTransactionally(
  uid: string,
  plan: PromoPurchasePlan,
): Promise<AuthorizePromoPurchaseTransactionResult> {
  const redemptionRef = db.doc(couponRedemptionDocPath(uid));

  try {
    return await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(redemptionRef);
      if (!snapshot.exists) return { status: 'no_redemption' };

      const stored = snapshot.data() as Record<string, unknown>;
      if (
        stored.uid !== uid ||
        !isNonEmptyString(stored.couponCode) ||
        !isNonEmptyString(stored.campaignId)
      ) {
        return { status: 'invalid_redemption' };
      }

      if (
        isFieldSet(stored.lockedAt) ||
        isFieldSet(stored.trialStartedAt) ||
        isFieldSet(stored.convertedAt)
      ) {
        return { status: 'redemption_consumed' };
      }

      if (!isValidIOSPromotionConfig(stored.iosPromotion)) {
        return { status: 'ios_promotion_unavailable' };
      }
      const iosPromotion: IOSPromotionConfig = stored.iosPromotion;
      const expectedProductId =
        plan === 'monthly' ? iosPromotion.monthlyProductId : iosPromotion.annualProductId;
      const desired: DesiredPromoPurchaseIntent = {
        campaignId: stored.campaignId,
        plan,
        expectedProductId,
        offeringIdentifier: iosPromotion.offeringIdentifier,
      };

      const now = Timestamp.now();
      let existingIntent: PromoPurchaseIntent | undefined;
      if (Object.prototype.hasOwnProperty.call(stored, 'purchaseIntent')) {
        const parsed = parseStoredPromoPurchaseIntent(stored.purchaseIntent);
        if (!parsed) return { status: 'invalid_redemption' };
        existingIntent = parsed;
      }

      const decision = decidePromoPurchaseIntent(existingIntent, desired, now);
      if (decision.action === 'reuse') {
        return { status: 'authorized', intent: decision.intent, reused: true };
      }
      if (decision.action === 'conflict') return { status: 'intent_conflict' };

      const intent: PromoPurchaseIntent = {
        ...desired,
        status: 'purchase_pending',
        createdAt: now,
        updatedAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + PROMO_PURCHASE_INTENT_TTL_MS),
      };

      transaction.set(
        redemptionRef,
        {
          purchaseIntent: intent,
          updatedAt: now,
        },
        { merge: true },
      );
      return { status: 'authorized', intent, reused: false };
    });
  } catch (err) {
    logFunctionError(SCOPE, err, { uid, plan });
    throw err;
  }
}
