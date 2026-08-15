/**
 * Context AuthScreen/PaywallScreen receive so their copy (only their copy —
 * see docs/onboarding_funnel_architecture.md §Auth/Paywall) can reflect
 * where the user came from, without adding any new auth/commerce logic.
 */
export type OnboardingAuthOrigin = 'planCompleted' | 'directLogin';

export interface OnboardingAuthContext {
  origin: OnboardingAuthOrigin;
  name?: string | null;
}
