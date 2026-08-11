import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearPendingTotpMfaSignInPoc,
  resolveTotpMfaSignInPoc,
  type TotpSignInChallenge,
} from '../services/totpMfaPoc';
import {
  mfaTotpIssueFromError,
  validateTotpCode,
  type MfaTotpIssue,
} from '../lib/mfaTotp';

export function useTotpMfaPocSignIn(
  challenge: TotpSignInChallenge,
  onCancel: () => void,
) {
  const [selectedHintUid, setSelectedHintUid] = useState(
    challenge.hints[0]?.uid ?? '',
  );
  const [code, setCode] = useState('');
  const [issue, setIssue] = useState<MfaTotpIssue | null>(null);
  const [resolving, setResolving] = useState(false);
  const operationLock = useRef(false);

  useEffect(
    () => () => {
      clearPendingTotpMfaSignInPoc();
    },
    [],
  );

  const resolve = useCallback(async () => {
    if (operationLock.current) return false;
    const localIssue = validateTotpCode(code.trim());
    if (localIssue) {
      setIssue(localIssue);
      return false;
    }

    operationLock.current = true;
    setResolving(true);
    setIssue(null);
    try {
      await resolveTotpMfaSignInPoc(selectedHintUid, code);
      // resolveSignIn updates Firebase Auth. AuthContext's existing listener and
      // the central guard own the next destination; this hook never navigates.
      return true;
    } catch (error) {
      setIssue(mfaTotpIssueFromError(error));
      return false;
    } finally {
      operationLock.current = false;
      setResolving(false);
    }
  }, [code, selectedHintUid]);

  const cancel = useCallback(() => {
    if (operationLock.current) return;
    clearPendingTotpMfaSignInPoc();
    setCode('');
    onCancel();
  }, [onCancel]);

  return {
    cancel,
    code,
    issue,
    resolve,
    resolving,
    selectedHintUid,
    setCode,
    setSelectedHintUid,
  };
}
