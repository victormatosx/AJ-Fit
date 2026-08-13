import { useCallback, useRef, useState } from 'react';
import {
  emailVerificationIssueFromError,
  type EmailVerificationIssue,
} from '../lib/emailVerification';
import { sendVerificationEmail } from '../services/emailVerification';
import { useAuth } from '../state/AuthContext';

type EmailVerificationOperation = 'checking' | 'resending' | 'signingOut' | null;

export function useEmailVerification() {
  const { user, refreshEmailVerification, logout } = useAuth();
  const [operation, setOperation] = useState<EmailVerificationOperation>(null);
  const [issue, setIssue] = useState<EmailVerificationIssue | null>(null);
  const [resent, setResent] = useState(false);
  const [verified, setVerified] = useState(false);
  const operationLock = useRef(false);

  const begin = useCallback((next: Exclude<EmailVerificationOperation, null>) => {
    if (operationLock.current) return false;
    operationLock.current = true;
    setOperation(next);
    setIssue(null);
    setResent(false);
    setVerified(false);
    return true;
  }, []);

  const finish = useCallback(() => {
    operationLock.current = false;
    setOperation(null);
  }, []);

  const check = useCallback(async (): Promise<boolean> => {
    if (!begin('checking')) return false;
    try {
      const emailVerified = await refreshEmailVerification();
      if (!emailVerified) {
        setIssue('stillUnverified');
        return false;
      }
      setVerified(true);
      return true;
    } catch (error) {
      setIssue(emailVerificationIssueFromError(error));
      return false;
    } finally {
      finish();
    }
  }, [begin, finish, refreshEmailVerification]);

  const resend = useCallback(async (): Promise<boolean> => {
    if (!begin('resending')) return false;
    try {
      await sendVerificationEmail();
      setResent(true);
      return true;
    } catch (error) {
      setIssue(emailVerificationIssueFromError(error));
      return false;
    } finally {
      finish();
    }
  }, [begin, finish]);

  const signOut = useCallback(async (): Promise<boolean> => {
    if (!begin('signingOut')) return false;
    try {
      await logout();
      return true;
    } catch (error) {
      setIssue(emailVerificationIssueFromError(error));
      return false;
    } finally {
      finish();
    }
  }, [begin, finish, logout]);

  return {
    busy: operation !== null,
    checking: operation === 'checking',
    email: user?.email ?? '',
    issue,
    resend,
    resending: operation === 'resending',
    resent,
    check,
    signOut,
    signingOut: operation === 'signingOut',
    verified,
  };
}
