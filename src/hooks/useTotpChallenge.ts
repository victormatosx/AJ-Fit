import { useCallback, useEffect, useRef, useState } from 'react';
import {
  mfaTotpIssueFromError,
  validateTotpCode,
  type MfaTotpIssue,
} from '../lib/mfaTotp';
import {
  clearTotpSignInChallenge,
  resolveTotpSignIn,
  type TotpSignInChallenge,
} from '../services/mfaTotp';
import {
  clearPendingSocialAuthState,
  finalizeSocialSignInAfterMfa,
} from '../services/socialAuth';

const TERMINAL_ISSUES: readonly MfaTotpIssue[] = [
  // In @firebase/auth 1.13.3 the backend SESSION_EXPIRED response is exposed
  // as auth/code-expired (there is no auth/session-expired public code).
  'expiredCode',
  'sessionExpired',
  'factorNotFound',
  'resolverWithoutHints',
];

export function useTotpChallenge(
  challenge: TotpSignInChallenge,
  callbacks: { onCancel: () => void; onSessionExpired: () => void },
) {
  const [selectedHintUid, setSelectedHintUid] = useState(
    challenge.hints[0]?.uid ?? '',
  );
  const [code, setCodeState] = useState('');
  const [issue, setIssue] = useState<MfaTotpIssue | null>(null);
  const [resolving, setResolving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const operationLock = useRef(false);

  useEffect(
    () => () => {
      clearTotpSignInChallenge();
      operationLock.current = false;
    },
    [],
  );

  const setCode = useCallback((value: string) => {
    setCodeState(value.replace(/\D/g, '').slice(0, 6));
    setIssue(null);
  }, []);

  const selectHint = useCallback((uid: string) => {
    if (operationLock.current) return;
    setSelectedHintUid(uid);
    setIssue(null);
  }, []);

  const resolve = useCallback(async (): Promise<boolean> => {
    if (operationLock.current || completed) return false;
    const localIssue = validateTotpCode(code);
    if (localIssue) {
      setIssue(localIssue);
      return false;
    }

    operationLock.current = true;
    setResolving(true);
    setIssue(null);
    try {
      const credential = await resolveTotpSignIn(selectedHintUid, code);
      // Authentication is complete at this point. The AuthContext listener is
      // the only authority that publishes User and loads profile/questionnaire.
      setCompleted(true);

      if (challenge.origin !== 'password') {
        await finalizeSocialSignInAfterMfa(
          credential.user,
          challenge.origin === 'account-linking',
        );
      }
      setCodeState('');
      return true;
    } catch (error) {
      const nextIssue = mfaTotpIssueFromError(error);
      if (TERMINAL_ISSUES.includes(nextIssue)) {
        clearTotpSignInChallenge();
        clearPendingSocialAuthState();
        setCodeState('');
        callbacks.onSessionExpired();
        return false;
      }

      // Invalid/expired OTP, network errors and throttling are retryable. The
      // resolver remains in memory and the user stays on this screen.
      setIssue(nextIssue);
      return false;
    } finally {
      operationLock.current = false;
      setResolving(false);
    }
  }, [callbacks, challenge.origin, code, completed, selectedHintUid]);

  const cancel = useCallback(() => {
    if (operationLock.current || completed) return;
    clearTotpSignInChallenge();
    clearPendingSocialAuthState();
    setCodeState('');
    setIssue(null);
    callbacks.onCancel();
  }, [callbacks, completed]);

  return {
    cancel,
    code,
    completed,
    issue,
    resolve,
    resolving,
    selectHint,
    selectedHintUid,
    setCode,
  };
}
