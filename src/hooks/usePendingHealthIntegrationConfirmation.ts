import { useCallback, useEffect, useRef, useState } from 'react';

import { getHealthPlatform } from '../services/healthIntegration';
import {
  clearHealthIntegrationOnboardingPendingConfirmation,
  markHealthIntegrationOnboardingStepSeen,
  readHealthIntegrationOnboardingPendingConfirmation,
} from '../services/healthIntegrationOnboardingStep';

/**
 * Fase 5 — the health-integration questionnaire step runs pre-auth and only
 * ever records an intent ("Conectar" was tapped); App.tsx turns that intent
 * into a per-uid "pending confirmation" flag once a real uid exists (see
 * `services/healthIntegrationOnboardingStep.ts`). This hook is the other
 * end: it tells `AppShell` whether that one-time confirmation sheet is still
 * owed to the signed-in uid — never auto-opens the native permission dialog
 * by itself, only decides whether to show the explicit-tap confirmation UI.
 */
export function usePendingHealthIntegrationConfirmation(uid: string | null): {
  visible: boolean;
  /** Call once the sheet is dismissed, whichever way (connect or skip) — never shows again for this uid. */
  resolve: () => void;
} {
  const [visible, setVisible] = useState(false);
  const checkedUidRef = useRef<string | null>(null);

  useEffect(() => {
    if (!uid) {
      checkedUidRef.current = null;
      setVisible(false);
      return;
    }
    if (checkedUidRef.current === uid) return;
    checkedUidRef.current = uid;
    if (getHealthPlatform() === 'unsupported') {
      setVisible(false);
      return;
    }
    void readHealthIntegrationOnboardingPendingConfirmation(uid).then((pending) => {
      if (checkedUidRef.current === uid) setVisible(pending);
    });
  }, [uid]);

  const resolve = useCallback(() => {
    if (!uid) return;
    setVisible(false);
    void Promise.all([
      clearHealthIntegrationOnboardingPendingConfirmation(uid),
      markHealthIntegrationOnboardingStepSeen(uid),
    ]);
  }, [uid]);

  return { visible, resolve };
}
