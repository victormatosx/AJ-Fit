import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getReauthenticationProviders,
  type ReauthenticationProvider,
} from '../lib/authProviders';
import {
  hasIdentityChanged,
  mfaTotpIssueFromError,
  validateTotpCode,
  type MfaTotpIssue,
} from '../lib/mfaTotp';
import {
  finishTotpUnenrollment,
  refreshTotpFactors,
  startTotpUnenrollment,
  type TotpFactor,
  type TotpUnenrollmentChallenge,
} from '../services/mfaTotp';
import { ReauthenticationCancelledError } from '../services/reauthentication';
import { useAuth } from '../state/AuthContext';

export function useTotpMfa(refreshToken = 0) {
  const { user } = useAuth();
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  // `loading` means "we have never resolved a status for the CURRENT
  // identity" — it starts `true` and, once the first `refresh()` call
  // (success or failure) completes, becomes `false` and stays `false`
  // forever after, even while a later background `refresh()` is in flight.
  // This is the fix for a reactivation flash: TwoFactorSettingsScreen calls
  // `refresh()` every time it becomes active (docs/23_navegacao_e_
  // lifecycle.md §5/§10) to keep the factor list current, but that must
  // never hide already-known-good content behind a full loading state
  // again — only the true first resolution (or a genuine identity change,
  // see the effect below) should ever do that. `refreshing` is the
  // separate, always-accurate "a fetch is in flight right now" signal for
  // a subtle indicator that doesn't gate content.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(true);
  const [issue, setIssue] = useState<MfaTotpIssue | null>(null);
  const [disableTarget, setDisableTarget] = useState<TotpFactor | null>(null);
  const [currentPassword, setCurrentPasswordState] = useState('');
  const [reauthCode, setReauthCodeState] = useState('');
  const [disableChallenge, setDisableChallenge] =
    useState<TotpUnenrollmentChallenge | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [disablingProvider, setDisablingProvider] =
    useState<ReauthenticationProvider | null>(null);
  const [disabled, setDisabled] = useState(false);
  const operationLock = useRef(false);
  const loadSequence = useRef(0);
  const reauthenticationProviders = getReauthenticationProviders(user);
  const canReauthenticateWithPassword =
    reauthenticationProviders.includes('password');
  const canReauthenticate = reauthenticationProviders.length > 0;

  const refresh = useCallback(async (): Promise<boolean> => {
    const sequence = ++loadSequence.current;
    setRefreshing(true);
    setIssue(null);
    try {
      const nextFactors = await refreshTotpFactors();
      if (sequence !== loadSequence.current) return false;
      setFactors(nextFactors);
      return true;
    } catch (error) {
      if (sequence === loadSequence.current) {
        setFactors([]);
        setIssue(mfaTotpIssueFromError(error));
      }
      return false;
    } finally {
      if (sequence === loadSequence.current) {
        setRefreshing(false);
        // Exits the unresolved state on the first completion (success OR
        // failure) and never re-enters it for this identity — a later
        // failed refresh still leaves whatever was last known on screen
        // instead of reverting to a full loading state.
        setLoading(false);
      }
    }
  }, []);

  // `undefined` (never run yet) is a distinct sentinel from a real `null`
  // uid, so the very first run always counts as an identity change below —
  // without it, an unauthenticated `user` (`uid == null`) on mount would
  // compare `null !== null` as false and skip the reset entirely.
  const prevUidRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const uid = user?.uid ?? null;
    const identityChanged = hasIdentityChanged(prevUidRef.current, uid);
    prevUidRef.current = uid;

    if (identityChanged) {
      // A brand-new identity (including the very first run) — nothing is
      // known about this account's MFA status yet, so this is the only
      // case that reverts to the full unresolved/loading state and clears
      // the previous identity's factor list. A `refreshToken` bump alone
      // (enrollment/disable completed elsewhere) must NOT do this — it
      // only needs a background `refresh()`, handled identically below.
      setLoading(true);
      setFactors([]);
    }
    setDisableTarget(null);
    setCurrentPasswordState('');
    setReauthCodeState('');
    setDisableChallenge(null);
    setDisabled(false);
    void refresh();
    return () => {
      loadSequence.current += 1;
      operationLock.current = false;
    };
  }, [refresh, refreshToken, user?.uid]);

  const requestDisable = useCallback(
    (factor: TotpFactor) => {
      setIssue(null);
      setDisabled(false);
      if (!canReauthenticate) {
        setIssue('reauthProviderUnsupported');
        return;
      }
      setCurrentPasswordState('');
      setReauthCodeState('');
      setDisableChallenge(null);
      setDisableTarget(factor);
    },
    [canReauthenticate],
  );

  const cancelDisable = useCallback(() => {
    if (operationLock.current) return;
    setDisableTarget(null);
    setCurrentPasswordState('');
    setReauthCodeState('');
    setDisableChallenge(null);
    setIssue(null);
  }, []);

  const setCurrentPassword = useCallback((value: string) => {
    setCurrentPasswordState(value);
    setIssue(null);
  }, []);

  const setReauthCode = useCallback((value: string) => {
    setReauthCodeState(value.replace(/\D/g, '').slice(0, 6));
    setIssue(null);
  }, []);

  const completeDisable = useCallback((nextFactors: TotpFactor[]) => {
    setFactors(nextFactors);
    setDisableTarget(null);
    setDisableChallenge(null);
    setCurrentPasswordState('');
    setReauthCodeState('');
    setDisabled(true);
  }, []);

  const confirmDisable = useCallback(async (
    provider: ReauthenticationProvider,
  ): Promise<boolean> => {
    if (operationLock.current || !disableTarget) return false;
    if (!reauthenticationProviders.includes(provider)) {
      setIssue('reauthProviderUnsupported');
      return false;
    }
    if (provider === 'password' && !currentPassword) {
      setIssue('passwordRequired');
      return false;
    }

    operationLock.current = true;
    setDisabling(true);
    setDisablingProvider(provider);
    setIssue(null);
    setDisabled(false);
    try {
      const result = await startTotpUnenrollment(
        disableTarget.uid,
        provider === 'password'
          ? { provider, password: currentPassword }
          : { provider },
      );
      setCurrentPasswordState('');
      if (result.status === 'challenge') {
        setDisableChallenge(result.challenge);
        setReauthCodeState('');
      } else {
        completeDisable(result.factors);
      }
      return true;
    } catch (error) {
      if (error instanceof ReauthenticationCancelledError) {
        setDisableTarget(null);
        setDisableChallenge(null);
        setCurrentPasswordState('');
        setReauthCodeState('');
        setIssue('reauthCancelled');
        return false;
      }
      if (provider !== 'password') setCurrentPasswordState('');
      setIssue(mfaTotpIssueFromError(error));
      return false;
    } finally {
      operationLock.current = false;
      setDisabling(false);
      setDisablingProvider(null);
    }
  }, [completeDisable, currentPassword, disableTarget, reauthenticationProviders]);

  const confirmDisablePassword = useCallback(
    () => confirmDisable('password'),
    [confirmDisable],
  );

  const confirmDisableCode = useCallback(async (): Promise<boolean> => {
    if (operationLock.current || !disableChallenge) return false;
    const validationIssue = validateTotpCode(reauthCode);
    if (validationIssue) {
      setIssue(validationIssue);
      return false;
    }

    operationLock.current = true;
    setDisabling(true);
    setIssue(null);
    try {
      const nextFactors = await finishTotpUnenrollment(
        disableChallenge,
        reauthCode,
      );
      completeDisable(nextFactors);
      return true;
    } catch (error) {
      setIssue(mfaTotpIssueFromError(error));
      return false;
    } finally {
      operationLock.current = false;
      setDisabling(false);
    }
  }, [completeDisable, disableChallenge, reauthCode]);

  return {
    cancelDisable,
    canReauthenticateWithPassword,
    canReauthenticate,
    confirmDisable,
    confirmDisableCode,
    confirmDisablePassword,
    currentPassword,
    disableTarget,
    disableChallenge,
    disabled,
    disabling,
    disablingProvider,
    enabled: factors.length > 0,
    factors,
    issue,
    loading,
    multipleFactors: factors.length > 1,
    reauthCode,
    reauthenticationProviders,
    refresh,
    refreshing,
    requestDisable,
    setCurrentPassword,
    setReauthCode,
  };
}
