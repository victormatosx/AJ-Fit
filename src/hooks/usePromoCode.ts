import { usePromoCodeContext } from '../state/PromoCodeContext';

/**
 * Thin accessor over the identity-scoped in-memory PromoCodeProvider.
 * Keeping the provider above RootNavigator makes authorization stable across
 * a Paywall remount without persisting it across app restarts.
 */
export function usePromoCode() {
  return usePromoCodeContext();
}
