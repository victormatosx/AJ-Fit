import { httpsCallable } from 'firebase/functions';
import { getToken } from 'firebase/app-check';
import { functions } from '../lib/firebaseFunctions';
import { auth, appCheck } from '../lib/firebase';
import { logError, logInfo, logWarn } from '../lib/logger';

/**
 * Client for the `confirmCommercialGate` Cloud Function (server-authoritative
 * second line of defense for `metadata.commercialGateResolvedAt` — see
 * `functions/src/billing/confirmCommercialGate.ts`'s module doc comment).
 *
 * This is a best-effort REQUEST for revalidation, never a claim of success:
 * the function takes no request body — identity comes exclusively from the
 * caller's own ID token — and this client never inspects, retries
 * aggressively, or surfaces its result as user-facing UI. `isPremium` (live
 * RevenueCat `CustomerInfo`, already wired through `SubscriptionContext`)
 * remains what actually unblocks navigation immediately after a purchase;
 * this call only helps the DURABLE server marker catch up sooner than the
 * async webhook might, so a later cancellation doesn't incorrectly reopen
 * the initial Paywall. Any failure here is swallowed — the webhook is still
 * the authoritative fallback.
 */

type ConfirmCommercialGateResponse = {
  status:
    | 'resolved'
    | 'already_resolved'
    | 'not_entitled'
    | 'ambiguous'
    | 'revenuecat_unavailable'
    | 'user_not_found';
};

const confirmCommercialGateCallable = httpsCallable<Record<string, never>, ConfirmCommercialGateResponse>(
  functions,
  'confirmCommercialGate',
);

/**
 * Fire-and-forget from the caller's perspective: never throws. Call this
 * right after a purchase/restore outcome classifies as `'premium'` — see
 * `PaywallScreen`'s `handlePurchase`/`handleRestore`.
 *
 * A real E2E observed `functions/unauthenticated` from this exact call: the
 * callable SDK only attaches an Authorization header when `auth.currentUser`
 * is non-null AND `getIdToken()` resolves at call time — `request.auth` on
 * the Cloud Function is populated exclusively from that header, so either
 * gap surfaces server-side as `unauthenticated`, indistinguishable from a
 * genuinely signed-out caller. Immediately after a purchase completes this
 * fires while the RN Firebase Auth persistence layer may still be settling
 * (fresh signup, first purchase within seconds — no unusual auth event, just
 * an ordinary async gap the SDK does not itself wait out). Forcing a fresh
 * ID token first closes that gap for both cases: `currentUser` missing
 * outright, or present with a token the SDK hasn't refreshed yet. This is
 * purely a client-side readiness check — it does not touch
 * `confirmCommercialGate`'s `requireAuth`/App Check, and a failure here
 * still resolves exactly as before (webhook fallback, never surfaced to the
 * user).
 */
export async function requestCommercialGateConfirmation(): Promise<void> {
  const startedAt = Date.now();
  try {
    if (!auth.currentUser) {
      logWarn('subscription', 'commercial_gate_confirmation_skipped_no_current_user', {});
      return;
    }
    // Audited root cause of a real E2E's `functions/unauthenticated`: this
    // callable is declared `enforceAppCheck: true` server-side
    // (`functions/src/billing/confirmCommercialGate.ts`). Firebase Functions
    // v2 rejects a call with no valid App Check token BEFORE `request.auth`
    // is ever inspected — the client SDK surfaces that rejection as
    // `functions/unauthenticated`, indistinguishable by error code alone
    // from a real Firebase Auth gap. Forcing the ID token refresh below
    // closes THAT gap, but does nothing for a missing App Check token — so
    // this checks App Check readiness separately, first, and logs it under
    // its own distinct outcome instead of letting it masquerade as an auth
    // bug. `appCheck` is `null` on web/Expo Go by design (see
    // `src/lib/firebaseAppCheck.ts`) — this callable is expected to be
    // unreachable from those environments today; that is reported here as
    // `app_check_unavailable`, not silently retried or swallowed as generic.
    if (!appCheck) {
      logWarn('subscription', 'commercial_gate_confirmation_app_check_unavailable', { reason: 'not_initialized' });
      return;
    }
    try {
      await getToken(appCheck, false);
    } catch (appCheckError) {
      logWarn('subscription', 'commercial_gate_confirmation_app_check_unavailable', {
        reason: 'token_fetch_failed',
        error: appCheckError,
      });
      return;
    }
    await auth.currentUser.getIdToken(true);
    const result = await confirmCommercialGateCallable({});
    logInfo('subscription', 'commercial_gate_confirmation_requested', {
      status: result.data.status,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    // Deliberately not rethrown: this is a best-effort acceleration of a
    // marker the webhook will still resolve on its own. See the module doc
    // comment above.
    logError('subscription:commercialGateConfirmation', err);
  }
}
