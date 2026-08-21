import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { db } from '../lib/firebaseAdmin';
import { requireAuth, requireVerifiedEmailForPrivateAccess } from '../lib/auth';
import { requireActiveAccount } from '../accountDeletion/activeAccountGuard';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import { COMMERCIAL_GATE_RESOLVED_AT_PATH, userDocPath } from './constants';
import {
  createRevenueCatV2Client,
  REVENUECAT_API_SECRET_KEY,
  RevenueCatApiError,
  type RevenueCatSubscriptionApi,
} from './revenueCatApi';
import { reconcileRevenueCatPremiumSubscriptions } from './revenueCatSubscription';

/**
 * Second, synchronous line of defense for `metadata.commercialGateResolvedAt`
 * (the initial-Paywall marker — see `UserProfile.metadata`'s doc comment in
 * src/services/userProfile.ts and `applySubscriptionEventAtomically` in
 * subscriptionSync.ts, which remains the FIRST/webhook-driven line of
 * defense and is untouched by this file).
 *
 * WHY this exists: a purchase/restore's `CustomerInfo` resolves `isPremium`
 * on the client immediately, but the async RevenueCat webhook that would
 * durably resolve this field can be delayed or — in the documented but rare
 * case of webhook delivery failure — never arrive at all. Without this, an
 * account could ride `isPremium` into the app, then fall back to the
 * initial Paywall on a later cancellation because the durable marker was
 * never actually written.
 *
 * SECURITY MODEL (this is the whole point of this module): the client only
 * ever REQUESTS a revalidation — it cannot claim premium status, cannot
 * supply a uid, and cannot supply a CustomerInfo/entitlement snapshot for
 * this function to trust. `request.auth.uid` (Firebase-verified) is the
 * only identity input; entitlement is independently re-derived here via a
 * direct call to the same server-side RevenueCat V2 API
 * (`revenueCatApi.ts`) already used by the webhook's TRANSFER
 * reconciliation path — no second billing system, no new client-trusted
 * boolean.
 */
const SCOPE = 'billing:confirmCommercialGate';

export type ConfirmCommercialGateResult =
  | { status: 'resolved' }
  | { status: 'already_resolved' }
  | { status: 'not_entitled' }
  | { status: 'ambiguous' }
  | { status: 'revenuecat_unavailable' }
  | { status: 'user_not_found' };

/**
 * Re-derives Premium entitlement directly from RevenueCat for `uid` and, ONLY
 * if it is genuinely active, resolves the gate marker — idempotently:
 *
 * - marker absent (legacy, predates the field) → no write, `already_resolved`
 *   (the client-side gate already treats absence as resolved; see the
 *   `UserProfile.metadata` doc comment — writing here would not change
 *   behavior, only add an unnecessary mutation to a document this module
 *   has no other reason to touch).
 * - marker already a `Timestamp` → no write, `already_resolved` (a later
 *   purchase must never rewrite the original resolution time — this is
 *   also what makes calling this function repeatedly, or racing it against
 *   the webhook, safe: whichever write commits second is a no-op).
 * - marker is exactly `null` (pending) → write `serverTimestamp()`,
 *   `resolved`.
 *
 * Every branch that is not `resolved`/`already_resolved` performs NO write
 * at all — a RevenueCat outage, an ambiguous multi-subscription state, or a
 * genuinely inactive entitlement all leave `commercialGateResolvedAt`
 * exactly as it was. The webhook remains free to resolve it later; `isPremium`
 * (live `CustomerInfo` on the client) can still carry the immediate
 * post-purchase UX regardless of this function's outcome — see
 * `src/lib/premiumGate.ts`.
 */
export async function confirmCommercialGateEntitlement(
  uid: string,
  revenueCatApi: RevenueCatSubscriptionApi = createRevenueCatV2Client(),
): Promise<ConfirmCommercialGateResult> {
  let subscriptions;
  try {
    // No `environment` filter: a sandbox-tester account's entitlement must
    // resolve the gate exactly like a production purchase — the client
    // never signals which environment it purchased in, and the gate marker
    // has no environment concept of its own.
    subscriptions = await revenueCatApi.getCustomerSubscriptions(uid);
  } catch (err) {
    logWarn(SCOPE, 'revenuecat_lookup_failed', {
      failureKind: err instanceof RevenueCatApiError ? err.kind : 'unknown',
    });
    return { status: 'revenuecat_unavailable' };
  }

  const reconciliation = reconcileRevenueCatPremiumSubscriptions(subscriptions);

  if (reconciliation.status === 'ambiguous') {
    logWarn(SCOPE, 'ambiguous_entitlement', {
      activeCandidateCount: reconciliation.activeCandidateCount,
    });
    return { status: 'ambiguous' };
  }

  if (reconciliation.status !== 'active') {
    return { status: 'not_entitled' };
  }

  const ref = db.doc(userDocPath(uid));
  const outcome = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return 'user_not_found' as const;

    const current = snapshot.get(COMMERCIAL_GATE_RESOLVED_AT_PATH) as Timestamp | null | undefined;
    if (current !== null) return 'already_resolved' as const;

    // `update()`, not `set(..., { merge: true })`: the Admin SDK only
    // parses a dotted string key like `COMMERCIAL_GATE_RESOLVED_AT_PATH` as
    // a nested field path for `update()`. With `set(..., { merge: true })`
    // it is stored as a literal top-level field named
    // `"metadata.commercialGateResolvedAt"` instead of nesting under
    // `metadata` — which then fails `nestedUserValid()`'s top-level
    // `hasOnly` in firestore.rules and permanently blocks the client from
    // ever updating its own profile again.
    transaction.update(ref, { [COMMERCIAL_GATE_RESOLVED_AT_PATH]: FieldValue.serverTimestamp() });
    return 'resolved' as const;
  });

  logInfo(SCOPE, `outcome_${outcome}`);
  return { status: outcome };
}

export async function handleConfirmCommercialGate(
  request: CallableRequest,
): Promise<ConfirmCommercialGateResult> {
  // Identity comes exclusively from the verified token — `request.data` is
  // never read by this handler, so a caller cannot claim to be, or act on
  // behalf of, any uid but its own.
  const uid = requireAuth(request);
  requireVerifiedEmailForPrivateAccess(request);
  await requireActiveAccount(uid);

  try {
    return await confirmCommercialGateEntitlement(uid);
  } catch (err) {
    logFunctionError(SCOPE, err);
    throw new HttpsError('internal', 'Could not confirm subscription status.');
  }
}

export const confirmCommercialGate = onCall(
  { secrets: [REVENUECAT_API_SECRET_KEY], enforceAppCheck: true },
  handleConfirmCommercialGate,
);
