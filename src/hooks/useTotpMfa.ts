import { useCallback, useEffect, useRef, useState } from 'react';
import { hasPasswordProvider } from '../lib/authProviders';
import {
  mfaTotpIssueFromError,
  validateTotpCode,
  type MfaTotpIssue,
} from '../lib/mfaTotp';
import {
  finishTotpUnenrollment,
  refreshTotpFactors,
  startTotpUnenrollmentWithPassword,
  type TotpFactor,
  type TotpUnenrollmentChallenge,
} from '../services/mfaTotp';
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
  const [disabled, setDisabled] = useState(false);
  const operationLock = useRef(false);
  const loadSequence = useRef(0);
  const canReauthenticateWithPassword = hasPasswordProvider(user);

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
      if (!canReauthenticateWithPassword) {
        setIssue('reauthProviderUnsupported');
        return;
      }
      setCurrentPasswordState('');
      setReauthCodeState('');
      setDisableChallenge(null);
      setDisableTarget(factor);
    },
    [canReauthenticateWithPassword],
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

  const confirmDisablePassword = useCallback(async (): Promise<boolean> => {
    if (operationLock.current || !disableTarget) return false;
    if (!currentPassword) {
      setIssue('passwordRequired');
      return false;
    }

    operationLock.current = true;
    setDisabling(true);
    setIssue(null);
    setDisabled(false);
    try {
      const result = await startTotpUnenrollmentWithPassword(
        disableTarget.uid,
        currentPassword,
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
      setIssue(mfaTotpIssueFromError(error));
      return false;
    } finally {
      operationLock.current = false;
      setDisabling(false);
    }
  }, [completeDisable, currentPassword, disableTarget]);

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
    confirmDisableCode,
    confirmDisablePassword,
    currentPassword,
    disableTarget,
    disableChallenge,
    disabled,
    disabling,
    enabled: factors.length > 0,
    factors,
    issue,
    loading,
    multipleFactors: factors.length > 1,
    reauthCode,
    refresh,
    requestDisable,
    setCurrentPassword,
    setReauthCode,
  };
}
