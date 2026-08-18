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
};

const AUTH_REQUIRED_SCREENS: RootScreenId[] = ['emailVerification', 'paywall', 'app'];

/**
 * Resolves the only screen the root router is allowed to render.
 *
 * `null` means that identity/profile/RevenueCat is still unresolved and the
 * router must render its neutral loading state. Once an authenticated user
 * has a questionnaire and the subscription state is resolved, AppShell opens
 * unconditionally — Premium's `isPremium` entitlement is no longer a
 * navigation requirement here (Fase 1 of the limited-mode rollout). It stays
 * on the state and keeps flowing through `useSubscription()` for the
 * per-capability gating that later phases add inside AppShell; this root
 * gate simply stops reading it.
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

  return 'app';
}
