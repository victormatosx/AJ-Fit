import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebaseFunctions';
import { logError, logInfo } from '../lib/logger';

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
 */
export async function requestCommercialGateConfirmation(): Promise<void> {
  try {
    const result = await confirmCommercialGateCallable({});
    logInfo('subscription', 'commercial_gate_confirmation_requested', {
      status: result.data.status,
    });
  } catch (err) {
    // Deliberately not rethrown: this is a best-effort acceleration of a
    // marker the webhook will still resolve on its own. See the module doc
    // comment above.
    logError('subscription:commercialGateConfirmation', err);
  }
}
