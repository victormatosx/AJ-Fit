import { useCallback, useEffect, useRef, useState } from 'react';

import {
  checkHealthAvailability,
  getGrantedHealthPermissions,
  getHealthPlatform,
  openNativeHealthSettings,
  requestHealthPermissions,
} from '../services/healthIntegration';
import {
  getLastKnownHealthIntegrationIntent,
  readHealthIntegrationIntent,
  setHealthIntegrationIntent,
} from '../services/healthIntegrationPreferences';
import {
  HealthIntegrationError,
  isHealthIntegrationActionBusy,
  type HealthAuthorizationSnapshot,
  type HealthAvailability,
  type HealthConnectionIntent,
  type HealthIntegrationErrorCode,
  type HealthPlatform,
} from '../types/healthIntegration';

export interface UseHealthIntegrationResult {
  platform: HealthPlatform | 'unsupported';
  availability: HealthAvailability;
  authorization: HealthAuthorizationSnapshot | null;
  intent: HealthConnectionIntent;
  loading: boolean;
  requestingPermissions: boolean;
  disconnecting: boolean;
  refreshing: boolean;
  /** A stable, translatable code — never a raw (often non-localized) error message. `null` when there is nothing to report. */
  errorCode: HealthIntegrationErrorCode | null;
  /** Re-checks OS availability and, on Android, the currently granted permissions. Safe to call repeatedly (e.g. on screen focus / app resume). No-ops while already in flight, or while the initial load is still running. */
  refresh: () => Promise<void>;
  /** Sets intent to `'enabled'` and triggers the native permission dialog. No-ops while a connect or disconnect is already in flight. */
  connect: () => Promise<void>;
  /** Sets intent to `'disabled'`. Does not revoke OS permissions or delete any data — see Fase 1 report for why. No-ops while a connect or disconnect is already in flight. */
  disconnect: () => Promise<void>;
  openNativeSettings: () => Promise<void>;
}

function errorCodeOf(cause: unknown): HealthIntegrationErrorCode {
  return cause instanceof HealthIntegrationError ? cause.code : 'unknown';
}

/**
 * This hook preloads nothing for a logged-out user — pass a real uid once one
 * exists.
 *
 * Concurrency model (fixed after a real-device bug — see
 * docs/health-integration Fase 2 regression notes): `uidEpoch` is bumped
 * **only** when `uid` changes, inside the effect below. Every async
 * operation (`refresh`, `connect`, `disconnect`, the initial load itself)
 * captures the epoch before starting and re-checks it before applying its
 * result — but only the uid-change effect is allowed to *advance* the epoch.
 *
 * `refresh()` used to advance a single shared counter itself. On iOS,
 * `HealthIntegrationScreen`'s `useScreenFocusEffect` calls `refresh()` on the
 * screen's very first activation (that hook fires on first activation too,
 * not just subsequent focus) — racing the initial load's own fetch. Because
 * both fetches shared one counter, `refresh()` advancing it made the initial
 * load's own completion look "stale" to itself, so its `setLoading(false)`
 * was skipped — `loading` stayed `true` forever, with no error (both fetches
 * actually succeeded; the result was just discarded). The duplicate
 * `availability_checked` log the user saw was the two concurrent fetches.
 * `refresh()` now only *reads* the epoch, and no-ops entirely while the
 * initial load is still running (`loadingRef`) instead of racing it.
 */
export function useHealthIntegration(uid: string | null): UseHealthIntegrationResult {
  const platform = getHealthPlatform();
  const [availability, setAvailability] = useState<HealthAvailability>({ status: 'unknown' });
  const [authorization, setAuthorization] = useState<HealthAuthorizationSnapshot | null>(null);
  const [intent, setIntent] = useState<HealthConnectionIntent>(
    () => (uid ? getLastKnownHealthIntegrationIntent(uid) : undefined) ?? 'not_configured',
  );
  const [loading, setLoading] = useState(true);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorCode, setErrorCode] = useState<HealthIntegrationErrorCode | null>(null);
  // Bumped exclusively by the uid-change effect below. `refresh`/`connect`/
  // `disconnect` only ever read it, to detect "the account changed while I
  // was in flight" — never to claim their own operation supersedes anyone
  // else's.
  const uidEpoch = useRef(0);
  const loadingRef = useRef(true);

  const refresh = useCallback(async () => {
    // The initial load (below) already fetches this exact data. Racing it
    // duplicates native calls for nothing, and historically caused `loading`
    // to get stuck — see the doc comment above.
    if (loadingRef.current) return;
    const requestEpoch = uidEpoch.current;
    setRefreshing(true);
    setAvailability({ status: 'checking' });
    try {
      const [nextAvailability, nextAuthorization] = await Promise.all([
        checkHealthAvailability(),
        getGrantedHealthPermissions(),
      ]);
      if (uidEpoch.current !== requestEpoch) return;
      setAvailability(nextAvailability);
      setAuthorization(nextAuthorization);
    } catch (cause) {
      if (uidEpoch.current !== requestEpoch) return;
      setAvailability({ status: 'unavailable', reason: 'check_failed' });
      setErrorCode(errorCodeOf(cause));
    } finally {
      if (uidEpoch.current === requestEpoch) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    uidEpoch.current += 1;
    const requestEpoch = uidEpoch.current;
    loadingRef.current = true;
    setLoading(true);
    setErrorCode(null);
    setAuthorization(null);
    setAvailability({ status: 'unknown' });
    setRequestingPermissions(false);
    setDisconnecting(false);
    setRefreshing(false);

    if (!uid) {
      setIntent('not_configured');
      loadingRef.current = false;
      setLoading(false);
      return;
    }

    setIntent(getLastKnownHealthIntegrationIntent(uid) ?? 'not_configured');

    void (async () => {
      const [nextIntent, nextAvailability, nextAuthorization] = await Promise.all([
        readHealthIntegrationIntent(uid),
        checkHealthAvailability(),
        getGrantedHealthPermissions(),
      ]);
      if (uidEpoch.current !== requestEpoch) return;
      setIntent(nextIntent);
      setAvailability(nextAvailability);
      setAuthorization(nextAuthorization);
      loadingRef.current = false;
      setLoading(false);
    })().catch((cause) => {
      if (uidEpoch.current !== requestEpoch) return;
      setErrorCode(errorCodeOf(cause));
      loadingRef.current = false;
      setLoading(false);
    });
  }, [uid]);

  const connect = useCallback(async () => {
    if (!uid || isHealthIntegrationActionBusy({ requestingPermissions, disconnecting })) return;
    const requestEpoch = uidEpoch.current;
    setRequestingPermissions(true);
    setErrorCode(null);
    try {
      await setHealthIntegrationIntent(uid, 'enabled');
      if (uidEpoch.current !== requestEpoch) return;
      setIntent('enabled');
      const snapshot = await requestHealthPermissions();
      if (uidEpoch.current !== requestEpoch) return;
      setAuthorization(snapshot);
    } catch (cause) {
      if (uidEpoch.current !== requestEpoch) return;
      setErrorCode(errorCodeOf(cause));
    } finally {
      if (uidEpoch.current === requestEpoch) setRequestingPermissions(false);
    }
  }, [uid, requestingPermissions, disconnecting]);

  const disconnect = useCallback(async () => {
    if (!uid || isHealthIntegrationActionBusy({ requestingPermissions, disconnecting })) return;
    const requestEpoch = uidEpoch.current;
    setDisconnecting(true);
    setErrorCode(null);
    try {
      const next = await setHealthIntegrationIntent(uid, 'disabled');
      if (uidEpoch.current !== requestEpoch) return;
      setIntent(next);
    } catch (cause) {
      if (uidEpoch.current !== requestEpoch) return;
      setErrorCode(errorCodeOf(cause));
    } finally {
      if (uidEpoch.current === requestEpoch) setDisconnecting(false);
    }
  }, [uid, requestingPermissions, disconnecting]);

  return {
    platform,
    availability,
    authorization,
    intent,
    loading,
    requestingPermissions,
    disconnecting,
    refreshing,
    errorCode,
    refresh,
    connect,
    disconnect,
    openNativeSettings: openNativeHealthSettings,
  };
}
