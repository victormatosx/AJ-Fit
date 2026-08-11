import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getReauthenticationProviders,
  type ReauthenticationProvider,
} from '../lib/authProviders';
import {
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
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
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
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setFactors([]);
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
    requestDisable,
    setCurrentPassword,
    setReauthCode,
  };
}
