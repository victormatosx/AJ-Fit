import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import {
  PROMO_PURCHASE_PLANS,
  type PromoPurchasePlan,
} from './constants';
import { authorizePromoPurchaseTransactionally } from './promoPurchaseIntent';
import type {
  AuthorizePromoPurchaseRequestData,
  AuthorizePromoPurchaseResponseData,
} from './types';

const SCOPE = 'attribution:authorizePromoPurchase';

function parseRequestPlan(data: unknown): PromoPurchasePlan | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const input = data as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'plan') return null;
  return (PROMO_PURCHASE_PLANS as readonly unknown[]).includes(input.plan)
    ? (input.plan as PromoPurchasePlan)
    : null;
}

/** Authenticated callable that accepts only the plan and derives every authority server-side. */
export async function authorizePromoPurchaseHandler(
  request: CallableRequest<AuthorizePromoPurchaseRequestData>,
): Promise<AuthorizePromoPurchaseResponseData> {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'authentication_required');
  }
  const uid = request.auth.uid;
  const plan = parseRequestPlan(request.data);
  if (!plan) {
    throw new HttpsError('invalid-argument', 'invalid_purchase_plan');
  }

  let result;
  try {
    result = await authorizePromoPurchaseTransactionally(uid, plan);
  } catch (err) {
    logFunctionError(SCOPE, err, { uid, plan });
    throw new HttpsError('internal', 'internal_error');
  }

  if (result.status === 'no_redemption') {
    throw new HttpsError('failed-precondition', 'promo_redemption_required');
  }
  if (result.status === 'invalid_redemption' || result.status === 'ios_promotion_unavailable') {
    logWarn(SCOPE, 'iOS promotion unavailable for redemption', { uid });
    throw new HttpsError('failed-precondition', 'ios_promotion_unavailable');
  }
  if (result.status === 'redemption_consumed') {
    throw new HttpsError('failed-precondition', 'promo_redemption_consumed');
  }
  if (result.status === 'intent_conflict') {
    throw new HttpsError('failed-precondition', 'promo_purchase_intent_conflict');
  }

  logInfo(SCOPE, 'promotional purchase authorized', { uid, plan, reused: result.reused });
  return {
    authorized: true,
    purchaseIntent: {
      plan: result.intent.plan,
      offeringIdentifier: result.intent.offeringIdentifier,
      expectedProductId: result.intent.expectedProductId,
      status: result.intent.status,
      expiresAt: result.intent.expiresAt.toDate().toISOString(),
    },
  };
}
