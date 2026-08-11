export type RootScreenId =
  | 'splash'
  | 'onboarding'
  | 'quiz'
  | 'analyzing'
  | 'plan'
  | 'auth'
  | 'paywall'
  | 'app';

type PremiumGateState = {
  requestedScreen: RootScreenId;
  authInitializing: boolean;
  profileLoading: boolean;
  authenticated: boolean;
  hasQuestionnaire: boolean;
  subscriptionLoading: boolean;
  subscriptionConfigured: boolean;
  isPremium: boolean;
};

const AUTH_REQUIRED_SCREENS: RootScreenId[] = ['paywall', 'app'];

/**
 * Resolves the only screen the root router is allowed to render.
 *
 * `null` means that identity/profile/RevenueCat is still unresolved and the
 * router must render its neutral loading state. Once an authenticated user has
 * a questionnaire, the requested screen is intentionally ignored: RevenueCat's
 * current `premium` entitlement alone chooses between AppShell and the paywall.
 */
export function resolvePremiumGate(state: PremiumGateState): RootScreenId | null {
  if (state.authInitializing || state.profileLoading) return null;

  if (!state.authenticated) {
    return AUTH_REQUIRED_SCREENS.includes(state.requestedScreen)
      ? 'auth'
      : state.requestedScreen;
  }

  if (!state.hasQuestionnaire) return 'quiz';

  if (state.subscriptionLoading || !state.subscriptionConfigured) return null;

  return state.isPremium ? 'app' : 'paywall';
}
