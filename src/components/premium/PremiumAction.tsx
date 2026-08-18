import type { ReactElement } from 'react';
import { usePremiumCapabilities } from '../../hooks/usePremiumCapabilities';
import { usePremiumAction } from '../../state/PremiumActionContext';
import type { PremiumCapability } from '../../lib/premiumCapabilities';

export type PremiumActionRenderProps = {
  /** `!canPerform(capability)` — display-only. Never gate anything yourself
   *  on this value; `onPress` already does that. Use it to swap an icon
   *  (`locked ? 'lock' : 'play'`) or an accessibility label, never to
   *  `disabled` the element (Fase 5: locked must stay tappable so Free can
   *  discover *why* it's blocked). */
  locked: boolean;
  /** Always call this from the element's own `onPress`/`onConfirm`. Runs
   *  `onAllowed` when permitted, opens `PremiumRequiredSheet` otherwise —
   *  never both, never partially. */
  onPress: () => void;
};

/**
 * Fase 5 (docs/13_assinaturas_e_billing.md): the one declarative primitive
 * for a Premium-gated visual entry point — a thin wrapper over the Fase 4
 * infrastructure (`usePremiumAction`/`requestPremiumAction`/
 * `PremiumRequiredSheet`), not a new authorization or UX system.
 *
 * Headless on purpose (renders exactly what `children` returns, no
 * surrounding View/Pressable of its own) so it never fights a card's flex
 * layout, a CtaButton's own touchable, or absolute positioning — see
 * `docs/13_assinaturas_e_billing.md` "PremiumAction vs requestPremiumAction"
 * for when to reach for this vs. the imperative call directly.
 *
 * Knows nothing about RevenueCat, CustomerInfo, Firestore, subscription
 * status, offerings, purchase/restore, or PaywallScreen — all of that stays
 * inside `PremiumActionProvider`/`PremiumRequiredSheet`. This component's
 * only job is: ask `canPerform` for display, and route the actual tap
 * through `requestPremiumAction`.
 *
 * NOT a security boundary — this is client-side UX + authorization exactly
 * like the rest of the Premium capability layer (Fase 2). Backend
 * authorization is a separate, not-yet-implemented concern; see the Fase 3
 * audit for which writes still depend on the client alone.
 */
export function PremiumAction({
  capability,
  onAllowed,
  children,
}: {
  capability: PremiumCapability;
  /**
   * Called synchronously by `onPress` when allowed — same as calling it
   * directly. `void | Promise<void>` only widens the type for a future
   * async entry point; nothing here awaits or adds a loading state, so an
   * async `onAllowed` behaves exactly as if `PremiumAction` weren't there
   * (fire-and-forget, matching every current call site).
   */
  onAllowed: () => void | Promise<void>;
  children: (props: PremiumActionRenderProps) => ReactElement;
}): ReactElement {
  // Read-only, for `locked` — the same `canPerform` `requestPremiumAction`
  // below re-checks to make its actual decision. Both read the same
  // `usePremiumCapabilities()` state, so display and gating can never
  // disagree; this isn't two competing decisions, it's the same one read
  // twice for two different purposes (what to render vs. what to allow).
  const { canPerform } = usePremiumCapabilities();
  const { requestPremiumAction } = usePremiumAction();

  const locked = !canPerform(capability);

  const onPress = () => {
    requestPremiumAction({ capability, onAllowed });
  };

  return children({ locked, onPress });
}
