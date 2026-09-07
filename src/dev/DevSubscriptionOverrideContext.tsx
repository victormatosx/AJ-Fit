import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { logInfo } from '../lib/logger';
import {
  createDevSubscriptionOverrideSession,
  isDevSubscriptionOverrideAllowed,
  isDevSubscriptionOverrideState,
  resolveDevSubscriptionOverrideForIdentity,
  type DevSubscriptionOverrideState,
} from './subscriptionOverride';
import { clearLegacyStoredDevSubscriptionOverride } from './subscriptionOverrideStorage';
import { useAuth } from '../state/AuthContext';

/**
 * Owns the reactive dev override state consumed by `SubscriptionContext`.
 * Mounted once, near the root, above `SubscriptionProvider` (see App.tsx).
 * `allowed` is `false` in every non-development bundle — in that case
 * `override` is hard-pinned to `'REAL'` and `setOverride` is a no-op,
 * regardless of what a screen tries to set it to.
 */
type DevSubscriptionOverrideCtx = {
  allowed: boolean;
  override: DevSubscriptionOverrideState;
  setOverride: (next: DevSubscriptionOverrideState) => Promise<void>;
};

const DevSubscriptionOverrideContext = createContext<DevSubscriptionOverrideCtx | null>(null);

export function DevSubscriptionOverrideProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const allowed = isDevSubscriptionOverrideAllowed();
  const [session, setSession] = useState(() => createDevSubscriptionOverrideSession(uid));
  const override = resolveDevSubscriptionOverrideForIdentity(session, uid, allowed);

  useEffect(() => {
    if (!allowed) return;
    void clearLegacyStoredDevSubscriptionOverride();
  }, [allowed]);

  useEffect(() => {
    if (session.uid === uid) return;
    setSession(createDevSubscriptionOverrideSession(uid));
    if (allowed) {
      logInfo('subscription', 'dev_subscription_override_identity_reset', { uidPresent: !!uid });
    }
  }, [allowed, session.uid, uid]);

  const setOverride = useCallback(
    async (next: DevSubscriptionOverrideState) => {
      if (!allowed) return;
      if (!isDevSubscriptionOverrideState(next)) {
        throw new Error(`[devSubscriptionOverride] invalid override: ${String(next)}`);
      }
      setSession({ uid, override: next });
      logInfo('subscription', 'dev_subscription_override_changed', { override: next });
    },
    [allowed, setSession, uid],
  );

  return (
    <DevSubscriptionOverrideContext.Provider
      value={{ allowed, override, setOverride }}
    >
      {children}
    </DevSubscriptionOverrideContext.Provider>
  );
}

export function useDevSubscriptionOverrideContext() {
  const ctx = useContext(DevSubscriptionOverrideContext);
  if (!ctx) {
    throw new Error('useDevSubscriptionOverrideContext outside DevSubscriptionOverrideProvider');
  }
  return ctx;
}
