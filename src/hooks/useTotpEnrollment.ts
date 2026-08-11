
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { hasPasswordProvider } from '../lib/authProviders';
import {
  mfaTotpIssueFromError,
  validateTotpCode,
  type MfaTotpIssue,
} from '../lib/mfaTotp';
import {
  finishTotpEnrollment,
  startTotpEnrollmentWithPassword,
  type TotpEnrollmentDraft,
  type TotpFactor,
} from '../services/mfaTotp';
import { useAuth } from '../state/AuthContext';

type EnrollmentOperation = 'reauthenticating' | 'enrolling' | 'copying' | 'opening' | null;

const TERMINAL_DRAFT_ISSUES: MfaTotpIssue[] = [
  'flowExpired',
  'sessionExpired',
  'userMissing',
  'alreadyEnabled',
  'emailUnverified',
];

export function useTotpEnrollment() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPasswordState] = useState('');
  const [draft, setDraftState] = useState<TotpEnrollmentDraft | null>(null);
  const [code, setCodeState] = useState('');
  const [operation, setOperation] = useState<EnrollmentOperation>(null);
  const [issue, setIssue] = useState<MfaTotpIssue | null>(null);
  const [copied, setCopied] = useState(false);
  const [activatedFactors, setActivatedFactors] = useState<TotpFactor[] | null>(null);
  const operationLock = useRef(false);
  const mountedRef = useRef(true);
  const draftRef = useRef<TotpEnrollmentDraft | null>(null);
  const userUidRef = useRef(user?.uid ?? null);
  const allowed = hasPasswordProvider(user);

  const replaceDraft = useCallback((next: TotpEnrollmentDraft | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const clearSensitiveState = useCallback(() => {
    replaceDraft(null);
    setCurrentPasswordState('');
    setCodeState('');
    setCopied(false);
  }, [replaceDraft]);

  useEffect(() => {
    const nextUid = user?.uid ?? null;
    if (userUidRef.current !== nextUid) {
      userUidRef.current = nextUid;
      clearSensitiveState();
      setIssue(null);
      setActivatedFactors(null);
    }
  }, [clearSensitiveState, user?.uid]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Explicitly sever the only non-React reference. React releases the
      // unmounted state itself; no secret is copied to storage or a singleton.
      draftRef.current = null;
      operationLock.current = false;
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!draft) return undefined;
    const remaining =
      Date.parse(draft.enrollmentCompletionDeadline) - Date.now();
    const expire = () => {
      clearSensitiveState();
      setIssue('flowExpired');
    };
    if (!Number.isFinite(remaining) || remaining <= 0) {
      expire();
      return undefined;
    }
    const timer = setTimeout(expire, remaining);
    return () => clearTimeout(timer);
  }, [clearSensitiveState, draft]);

  const setCurrentPassword = useCallback((value: string) => {
    setCurrentPasswordState(value);
    setIssue(null);
  }, []);

  const setCode = useCallback((value: string) => {
    setCodeState(value.replace(/\D/g, '').slice(0, 6));
    setIssue(null);
  }, []);

  const beginEnrollment = useCallback(async (): Promise<boolean> => {
    if (operationLock.current) return false;
    if (!allowed) {
      setIssue('reauthProviderUnsupported');
      return false;
    }
    if (!currentPassword) {
      setIssue('passwordRequired');
      return false;
    }

    operationLock.current = true;
    setOperation('reauthenticating');
    setIssue(null);
    setActivatedFactors(null);
    try {
      const nextDraft = await startTotpEnrollmentWithPassword(currentPassword);
      if (
        !mountedRef.current ||
        userUidRef.current !== nextDraft.userUid
      ) {
        return false;
      }
      replaceDraft(nextDraft);
      setCurrentPasswordState('');
      setCodeState('');
      return true;
    } catch (error) {
      if (!mountedRef.current) return false;
      clearSensitiveState();
      setIssue(mfaTotpIssueFromError(error));
      return false;
    } finally {
      operationLock.current = false;
      if (mountedRef.current) setOperation(null);
    }
  }, [allowed, clearSensitiveState, currentPassword, replaceDraft]);

  const confirmEnrollment = useCallback(async (): Promise<boolean> => {
    if (operationLock.current || !draftRef.current) return false;
    const validationIssue = validateTotpCode(code);
    if (validationIssue) {
      setIssue(validationIssue);
      return false;
    }

    operationLock.current = true;
    setOperation('enrolling');
    setIssue(null);
    try {
      const factors = await finishTotpEnrollment(draftRef.current, code);
      if (!mountedRef.current) return false;
      clearSensitiveState();
      setActivatedFactors(factors);
      return true;
    } catch (error) {
      if (!mountedRef.current) return false;
      const nextIssue = mfaTotpIssueFromError(error);
      if (TERMINAL_DRAFT_ISSUES.includes(nextIssue)) replaceDraft(null);
      setIssue(nextIssue);
      return false;
    } finally {
      operationLock.current = false;
      if (mountedRef.current) setOperation(null);
    }
  }, [clearSensitiveState, code, replaceDraft]);

  const copySecret = useCallback(async (): Promise<boolean> => {
    const secretKey = draftRef.current?.secretKey;
    if (!secretKey || operationLock.current) return false;
    operationLock.current = true;
    setOperation('copying');
    setIssue(null);
    try {
      await Clipboard.setStringAsync(secretKey);
      if (!mountedRef.current) return false;
      setCopied(true);
      return true;
    } catch {
      if (!mountedRef.current) return false;
      setIssue('clipboardFailed');
      return false;
    } finally {
      operationLock.current = false;
      if (mountedRef.current) setOperation(null);
    }
  }, []);

  const openAuthenticator = useCallback(async (): Promise<boolean> => {
    const uri = draftRef.current?.otpAuthUri;
    if (!uri || operationLock.current) return false;
    operationLock.current = true;
    setOperation('opening');
    setIssue(null);
    try {
      await Linking.openURL(uri);
      if (!mountedRef.current) return false;
      return true;
    } catch {
      if (!mountedRef.current) return false;
      setIssue('authenticatorUnavailable');
      return false;
    } finally {
      operationLock.current = false;
      if (mountedRef.current) setOperation(null);
    }
  }, []);

  const cancel = useCallback(() => {
    if (operationLock.current) return false;
    clearSensitiveState();
    setIssue(null);
    setActivatedFactors(null);
    return true;
  }, [clearSensitiveState]);

  return {
    activated: activatedFactors !== null,
    allowed,
    beginEnrollment,
    busy: operation !== null,
    cancel,
    code,
    confirmEnrollment,
    copySecret,
    copied,
    copying: operation === 'copying',
    currentPassword,
    draft,
    enrolling: operation === 'enrolling',
    issue,
    openAuthenticator,
    opening: operation === 'opening',
    reauthenticating: operation === 'reauthenticating',
    setCode,
    setCurrentPassword,
  };
}
