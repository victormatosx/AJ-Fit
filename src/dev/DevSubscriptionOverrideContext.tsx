import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { logInfo } from '../lib/logger';
import { isDevSubscriptionOverrideAllowed, type DevSubscriptionOverrideState } from './subscriptionOverride';
import {
  readStoredDevSubscriptionOverride,
  writeStoredDevSubscriptionOverride,
} from './subscriptionOverrideStorage';

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
  const allowed = isDevSubscriptionOverrideAllowed();
  const [override, setOverrideState] = useState<DevSubscriptionOverrideState>('REAL');

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    void readStoredDevSubscriptionOverride().then((stored) => {
      if (!cancelled) setOverrideState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const setOverride = useCallback(
    async (next: DevSubscriptionOverrideState) => {
      if (!allowed) return;
      await writeStoredDevSubscriptionOverride(next);
      setOverrideState(next);
      logInfo('subscription', 'dev_subscription_override_changed', { override: next });
    },
    [allowed],
  );

  return (
    <DevSubscriptionOverrideContext.Provider
      value={{ allowed, override: allowed ? override : 'REAL', setOverride }}
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
