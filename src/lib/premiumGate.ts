/**
 * `'onboardingFunnel'` covers the entire pre-auth acquisition funnel — what
 * used to be five separate root screens ('onboarding'|'quiz'|'socialProof'|
 * 'analyzing'|'plan') collapsed into one. The gate treats all of it
 * homogeneously (a single "not yet authenticated / no questionnaire yet"
 * bucket), so this collapse changes no gate priority or test assertion —
 * the internal 26-step sequence is owned entirely by
 * `src/onboarding/steps.ts` + `OnboardingFunnelScreen`, which this module
 * never needs to know about.
 */
export type RootScreenId =
  | 'splash'
  | 'onboardingFunnel'
  | 'auth'
  | 'emailVerification'
  | 'paywall'
  | 'app';

type PremiumGateState = {
  requestedScreen: RootScreenId;
  authInitializing: boolean;
  profileLoading: boolean;
  authenticated: boolean;
  /** Firebase requires a password user's verified server-backed e-mail. */
  emailVerificationRequired: boolean;
  /**
   * True while account-preference reconciliation (language/units —
   * `src/i18n/syncLanguage.ts`, `src/units/syncUnits.ts`) is in flight for the
   * current profile-load cycle. Only ever `true` for an authenticated user
   * (reconciliation never starts without one) — unauthenticated routing is
   * unaffected. Held like `profileLoading`: the gate stays neutral so the
   * first authed screen renders with reconciled preferences already applied.
   * This never gates on Premium/entitlement — it only delays which screen
   * becomes visible, same as the other pre-Premium checks below.
   */
  preferencesReconciling: boolean;
  hasQuestionnaire: boolean;
  subscriptionLoading: boolean;
  subscriptionConfigured: boolean;
  isPremium: boolean;
  /**
   * Server-backed marker distinguishing a brand-new account (never resolved
   * its initial commercial gate) from an established one (legacy account
   * that predates this field, or one that already completed
   * purchase/restore at least once) — see `UserProfile.metadata`'s doc
   * comment in src/services/userProfile.ts for the full null/absent/
   * timestamp lifecycle. `true` for every established account; `false`
   * ONLY for a still-pending new account. Reintroduces the pre-"Fase 1"
   * root Paywall (`src/lib/premiumGate.ts` history, commit `5fc0fa1`), but
   * scoped to this one case instead of every non-Premium user — established
   * non-Premium accounts still open AppShell unconditionally, unchanged
   * from Fase 1, gated per-capability inside it (`premiumCapabilities.ts`).
   */
  commercialGateResolved: boolean;
};

const AUTH_REQUIRED_SCREENS: RootScreenId[] = ['emailVerification', 'paywall', 'app'];

/**
 * Resolves the only screen the root router is allowed to render.
 *
 * `null` means that identity/profile/RevenueCat is still unresolved and the
 * router must render its neutral loading state. Once an authenticated user
 * has a questionnaire and the subscription state is resolved, AppShell opens
 * for every ESTABLISHED account regardless of `isPremium` (Fase 1 of the
 * limited-mode rollout) — Premium keeps flowing through `useSubscription()`
 * for the per-capability gating inside AppShell (`premiumCapabilities.ts`);
 * this root gate does not read `isPremium` for that population.
 *
 * The one case Fase 1 did not intend to cover: a brand-new account that has
 * never resolved its initial commercial gate at all. That population still
 * sees `'paywall'` here — same as the pre-Fase-1 behavior, but scoped by
 * `commercialGateResolved` instead of applying to every non-Premium user.
 * `isPremium` short-circuits straight to `'app'` even before the server
 * marker catches up (the RevenueCat SDK's `CustomerInfo` resolves faster
 * than the webhook-driven Firestore write — see subscriptionSync.ts).
 */
export function resolvePremiumGate(state: PremiumGateState): RootScreenId | null {
  if (state.authInitializing || state.profileLoading) return null;

  if (!state.authenticated) {
    return AUTH_REQUIRED_SCREENS.includes(state.requestedScreen)
      ? 'auth'
      : state.requestedScreen;
  }

  if (state.emailVerificationRequired) return 'emailVerification';

  if (state.preferencesReconciling) return null;

  if (!state.hasQuestionnaire) return 'onboardingFunnel';

  if (state.subscriptionLoading || !state.subscriptionConfigured) return null;

  if (!state.commercialGateResolved && !state.isPremium) return 'paywall';

  return 'app';
}
