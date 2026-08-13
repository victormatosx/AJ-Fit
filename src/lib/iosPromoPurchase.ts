import type { PurchasesPackage } from 'react-native-purchases';
import type { IOSPromotionAuthorization } from './promoCodeState';
import type { IOSSubscriptionPlan } from './subscriptionOffer';

export interface PromoPurchaseIntentAuthorization {
  authorized: true;
  purchaseIntent: {
    plan: IOSSubscriptionPlan;
    offeringIdentifier: string;
    expectedProductId: string;
    status: 'purchase_pending';
    expiresAt: string;
  };
}

export type PromoPurchaseAuthorizationOutcome =
  | { status: 'authorized'; response: PromoPurchaseIntentAuthorization }
  | {
      status: 'failed';
      reason: 'unauthenticated' | 'conflict' | 'unavailable' | 'temporary' | 'invalid_response';
    };

export interface IOSPromoPurchaseAttempt {
  plan: IOSSubscriptionPlan;
  authorization: IOSPromotionAuthorization;
  package: PurchasesPackage;
}

export interface IOSPromoPurchaseSnapshot {
  uid: string;
  generation: number;
  code: string;
  attempt: IOSPromoPurchaseAttempt;
}

/** Opaque local fingerprint only; never logged or sent to the backend. */
export function iosPromoPurchaseSnapshotKey(snapshot: IOSPromoPurchaseSnapshot): string {
  const { attempt } = snapshot;
  return JSON.stringify([
    snapshot.uid,
    snapshot.generation,
    snapshot.code,
    attempt.plan,
    attempt.authorization.offeringIdentifier,
    attempt.authorization.monthlyProductId,
    attempt.authorization.annualProductId,
    attempt.package.identifier,
    attempt.package.product.identifier,
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strict callable-boundary parser; extra/missing/wrongly typed fields fail closed. */
export function parsePromoPurchaseIntentAuthorization(
  value: unknown,
): PromoPurchaseIntentAuthorization | null {
  if (!isRecord(value) || Object.keys(value).length !== 2 || value.authorized !== true) return null;
  if (!isRecord(value.purchaseIntent) || Object.keys(value.purchaseIntent).length !== 5) return null;
  const intent = value.purchaseIntent;
  const hasCleanIdentifier = (candidate: unknown): candidate is string =>
    typeof candidate === 'string' && candidate.length > 0 && candidate.trim() === candidate;
  const expiresAtMs =
    typeof intent.expiresAt === 'string' ? Date.parse(intent.expiresAt) : Number.NaN;
  if (
    (intent.plan !== 'monthly' && intent.plan !== 'annual') ||
    !hasCleanIdentifier(intent.offeringIdentifier) ||
    !hasCleanIdentifier(intent.expectedProductId) ||
    intent.status !== 'purchase_pending' ||
    typeof intent.expiresAt !== 'string' ||
    !Number.isFinite(expiresAtMs) ||
    new Date(expiresAtMs).toISOString() !== intent.expiresAt
  ) {
    return null;
  }
  return value as unknown as PromoPurchaseIntentAuthorization;
}

export function classifyPromoPurchaseAuthorizationError(
  err: unknown,
): Extract<PromoPurchaseAuthorizationOutcome, { status: 'failed' }>['reason'] {
  const code = isRecord(err) && 'code' in err ? String(err.code) : undefined;
  const message = isRecord(err) && 'message' in err ? String(err.message) : undefined;
  if (code === 'functions/unauthenticated') return 'unauthenticated';
  if (
    code === 'functions/failed-precondition' &&
    message === 'promo_purchase_intent_conflict'
  ) {
    return 'conflict';
  }
  if (
    code === 'functions/failed-precondition' &&
    ['promo_redemption_required', 'ios_promotion_unavailable', 'promo_redemption_consumed'].includes(
      message ?? '',
    )
  ) {
    return 'unavailable';
  }
  return 'temporary';
}

export type PromoPurchaseIntentValidation =
  | { status: 'valid'; expiresAtMs: number }
  | {
      status: 'invalid';
      reason:
        | 'not_authorized'
        | 'plan_mismatch'
        | 'offering_mismatch'
        | 'product_mismatch'
        | 'status_mismatch'
        | 'expiry_invalid'
        | 'expired';
    };

/** Revalidates every server-owned field against the exact tap snapshot. */
export function validatePromoPurchaseIntent(
  response: PromoPurchaseIntentAuthorization,
  attempt: IOSPromoPurchaseAttempt,
  nowMs: number,
): PromoPurchaseIntentValidation {
  if (response.authorized !== true) return { status: 'invalid', reason: 'not_authorized' };
  const intent = response.purchaseIntent;
  if (intent.plan !== attempt.plan) return { status: 'invalid', reason: 'plan_mismatch' };
  if (intent.offeringIdentifier !== attempt.authorization.offeringIdentifier) {
    return { status: 'invalid', reason: 'offering_mismatch' };
  }
  if (intent.expectedProductId !== attempt.package.product.identifier) {
    return { status: 'invalid', reason: 'product_mismatch' };
  }
  if (intent.status !== 'purchase_pending') {
    return { status: 'invalid', reason: 'status_mismatch' };
  }
  const expiresAtMs = Date.parse(intent.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return { status: 'invalid', reason: 'expiry_invalid' };
  if (expiresAtMs <= nowMs) return { status: 'invalid', reason: 'expired' };
  return { status: 'valid', expiresAtMs };
}

export type IOSPromoPurchaseExecution<P> =
  | { status: 'purchased'; result: P }
  | { status: 'stale' }
  | { status: 'authorization_failed'; outcome: Extract<PromoPurchaseAuthorizationOutcome, { status: 'failed' }> }
  | { status: 'intent_invalid'; reason: Extract<PromoPurchaseIntentValidation, { status: 'invalid' }>['reason'] };

/**
 * Executes the mandatory late-intent sequence. `isCurrent` is checked both
 * before and after the network authorization, preventing an old UID/coupon/
 * plan snapshot from reaching StoreKit.
 */
export async function executeIOSPromoPurchase<P>({
  attempt,
  authorize,
  purchase,
  isCurrent,
  now = Date.now,
}: {
  attempt: IOSPromoPurchaseAttempt;
  authorize: (plan: IOSSubscriptionPlan) => Promise<PromoPurchaseAuthorizationOutcome>;
  purchase: (pkg: PurchasesPackage) => Promise<P>;
  isCurrent: () => boolean;
  now?: () => number;
}): Promise<IOSPromoPurchaseExecution<P>> {
  if (!isCurrent()) return { status: 'stale' };
  const authorizationOutcome = await authorize(attempt.plan);
  if (!isCurrent()) return { status: 'stale' };
  if (authorizationOutcome.status === 'failed') {
    return { status: 'authorization_failed', outcome: authorizationOutcome };
  }

  const validation = validatePromoPurchaseIntent(
    authorizationOutcome.response,
    attempt,
    now(),
  );
  if (validation.status === 'invalid') {
    return { status: 'intent_invalid', reason: validation.reason };
  }
  if (!isCurrent()) return { status: 'stale' };
  if (validation.expiresAtMs <= now()) {
    return { status: 'intent_invalid', reason: 'expired' };
  }
  return { status: 'purchased', result: await purchase(attempt.package) };
}
