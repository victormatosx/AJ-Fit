import type { SubscriptionCenterStatus } from './subscriptionCenter';

/**
 * Fase 4 (docs/13_assinaturas_e_billing.md): resolves which CTA copy a
 * blocked-action sheet should show, reusing `subscriptionCenter.ts`'s
 * already-built status model (Fase 0 audit found it distinguishes "never
 * subscribed" from "subscribed, needs to renew" — this is the first place
 * that distinction actually reaches the user) instead of re-deriving it.
 *
 * This module does not decide access — `canPerform` (Fase 2) already denied
 * the action before anything here runs. `resolveStatus` in
 * `subscriptionCenter.ts` only returns a status other than 'unknown'/
 * 'expired' when `activeEntitlement` is truthy, i.e. exactly when
 * `isPremium`/`canPerform` would already be `true`. In other words: by the
 * time a blocked-action sheet is shown, `status` can only genuinely be
 * 'unknown' (no entitlement, no subscription history at all — never
 * subscribed) or 'expired' (had one, it lapsed). 'subscribe' covers the
 * documented case; 'renew' covers the documented case; 'unlock' is a
 * defensive fallback for a status this analysis says shouldn't reach here —
 * it deliberately never claims RENOVAR for a user we can't prove ever
 * subscribed.
 *
 * Fase 6 audited and confirmed this by construction rather than leaving it
 * as a comment: `src/lib/__tests__/premiumEntitlementPrecedence.test.ts`
 * builds real `CustomerInfo` fixtures for every entitlement-active status
 * (`active`/`trial`/`canceled`/`grace_period`/`billing_issue`) and proves
 * `canPerformPremiumCapability` allows every capability for each of them —
 * i.e. this function's `default: 'unlock'` branch is provably unreachable
 * from `PremiumActionContext`, not just assumed to be.
 *
 * `resolveSubscriptionCenterModel`'s entitlement-active statuses each
 * already have their own admin-facing presentation, built independently in
 * `SubscriptionCenterScreen.tsx` (badge/description/primary-fact/manage
 * action per status) — audited in Fase 6 and left untouched: it already
 * treats "canceled but still entitled" as full access with an informational
 * date, already never blocks anything on billing_issue/grace_period while
 * the entitlement holds, and already never invents a date it doesn't have.
 * Widening `PremiumUpgradeIntent` with `manage_billing`/`manage_subscription`
 * intents this module could never actually produce would model dead states
 * here instead of reusing that already-correct, already-tested screen.
 */
export type PremiumUpgradeIntent = 'subscribe' | 'renew' | 'unlock';

export function resolvePremiumUpgradeIntent(
  status: SubscriptionCenterStatus,
): PremiumUpgradeIntent {
  switch (status) {
    case 'unknown':
      return 'subscribe';
    case 'expired':
      return 'renew';
    default:
      return 'unlock';
  }
}
