import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useSubscription } from '../hooks/useSubscription';
import { usePremiumCapabilities } from '../hooks/usePremiumCapabilities';
import { resolveSubscriptionCenterModel } from '../lib/subscriptionCenter';
import { resolvePremiumUpgradeIntent } from '../lib/premiumUpgradeIntent';
import type { PremiumCapability } from '../lib/premiumCapabilities';
import { PremiumRequiredSheet } from '../components/premium/PremiumRequiredSheet';

/**
 * Fase 4 (docs/13_assinaturas_e_billing.md): the single reusable place a
 * feature asks "can the user do this, and if not, show the standard
 * blocked-action UX" — so no screen has to hand-roll
 * `if (!canPerform(...)) { setSomeModalOpen(true); return; }` on its own.
 *
 * This does NOT decide access — it reads `canPerform` from
 * `usePremiumCapabilities()` (Fase 2), which is still the only authority.
 * `RevenueCat → SubscriptionContext → isPremium → usePremiumCapabilities →
 * canPerform` is untouched; this layer only adds what happens in the
 * `false` branch.
 *
 * Fase 5 adds exactly one consumer on top of this, no parallel provider:
 * `<PremiumAction>` (`../components/premium/PremiumAction.tsx`) for
 * declarative visual entry points. `requestPremiumAction` below stays the
 * imperative escape hatch for handlers where a wrapper component doesn't
 * fit (e.g. `ProgressPhotosScreen`'s `confirmDelete`). Both call this exact
 * function — there is no second decision path.
 */
type RequestPremiumActionArgs = {
  capability: PremiumCapability;
  /** Called synchronously, never awaited here — see `PremiumAction.tsx` for
   *  why `Promise<void>` is accepted without adding any loading state. */
  onAllowed: () => void | Promise<void>;
};

type PremiumActionCtx = {
  requestPremiumAction: (args: RequestPremiumActionArgs) => void;
};

const PremiumActionContext = createContext<PremiumActionCtx | null>(null);

export function usePremiumAction() {
  const ctx = useContext(PremiumActionContext);
  if (!ctx) throw new Error('usePremiumAction outside PremiumActionProvider');
  return ctx;
}

export function PremiumActionProvider({
  children,
  /**
   * Fase 4 reuses the Paywall exactly as it already exists (on-demand modal,
   * wired by AppShell via `showPremium`/`<PaywallScreen>`) rather than
   * mounting a second instance — this callback IS that existing trigger, not
   * a new one.
   */
  onRequestUpgrade,
}: {
  children: React.ReactNode;
  onRequestUpgrade: () => void;
}) {
  const { profile } = useAuth();
  const { canPerform } = usePremiumCapabilities();
  const { customerInfo, offerings } = useSubscription();
  const [pending, setPending] = useState<PremiumCapability | null>(null);

  const requestPremiumAction = useCallback(
    ({ capability, onAllowed }: RequestPremiumActionArgs) => {
      if (canPerform(capability)) {
        onAllowed();
        return;
      }
      setPending(capability);
    },
    [canPerform],
  );

  const value = useMemo(() => ({ requestPremiumAction }), [requestPremiumAction]);

  // Same status model SubscriptionCenterScreen already uses — recomputed
  // here, not re-implemented (docs/13_assinaturas_e_billing.md). Only
  // evaluated while a sheet is actually pending, so it costs nothing on the
  // (overwhelmingly more common) allowed path.
  const status = useMemo(
    () =>
      pending
        ? resolveSubscriptionCenterModel({
            customerInfo,
            offerings,
            mirror: profile?.subscription ?? null,
          }).status
        : null,
    [pending, customerInfo, offerings, profile?.subscription],
  );

  const dismiss = useCallback(() => setPending(null), []);

  const handleRequestUpgrade = useCallback(() => {
    setPending(null);
    onRequestUpgrade();
  }, [onRequestUpgrade]);

  return (
    <PremiumActionContext.Provider value={value}>
      {children}
      <PremiumRequiredSheet
        visible={pending !== null}
        capability={pending}
        intent={status ? resolvePremiumUpgradeIntent(status) : 'unlock'}
        onDismiss={dismiss}
        onRequestUpgrade={handleRequestUpgrade}
      />
    </PremiumActionContext.Provider>
  );
}
