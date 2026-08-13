import { useCallback, useRef, useState } from 'react';
import {
  passwordChangeIssueFromError,
  validatePasswordChange,
  type PasswordChangeIssue,
} from '../lib/passwordChange';
import { hasPasswordProvider } from '../lib/authProviders';
import { changePasswordWithReauthentication } from '../services/password';
import { useAuth } from '../state/AuthContext';

export function useChangePassword() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPasswordState] = useState('');
  const [newPassword, setNewPasswordState] = useState('');
  const [confirmation, setConfirmationState] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [issue, setIssue] = useState<PasswordChangeIssue | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const submitLock = useRef(false);
  const allowed = hasPasswordProvider(user);

  const resetFeedback = useCallback(() => {
    setIssue(null);
    setSucceeded(false);
  }, []);

  const setCurrentPassword = useCallback((value: string) => {
    setCurrentPasswordState(value);
    resetFeedback();
  }, [resetFeedback]);

  const setNewPassword = useCallback((value: string) => {
    setNewPasswordState(value);
    resetFeedback();
  }, [resetFeedback]);

  const setConfirmation = useCallback((value: string) => {
    setConfirmationState(value);
    resetFeedback();
  }, [resetFeedback]);

  const submit = useCallback(async (): Promise<boolean> => {
    if (submitLock.current) return false;

    setIssue(null);
    setSucceeded(false);
    const input = { currentPassword, newPassword, confirmation };
    const validationIssue = validatePasswordChange(input);
    if (validationIssue) {
      setIssue(validationIssue);
      return false;
    }
    if (!user) {
      setIssue('sessionExpired');
      return false;
    }
    if (!hasPasswordProvider(user)) {
      setIssue('providerRequired');
      return false;
    }

    submitLock.current = true;
    setSubmitting(true);
    try {
      await changePasswordWithReauthentication(input);
      setCurrentPasswordState('');
      setNewPasswordState('');
      setConfirmationState('');
      setSucceeded(true);
      return true;
    } catch (error) {
      setIssue(passwordChangeIssueFromError(error));
      return false;
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }, [confirmation, currentPassword, newPassword, user]);

  return {
    allowed,
    confirmation,
    currentPassword,
    issue,
    newPassword,
    setConfirmation,
    setCurrentPassword,
    setNewPassword,
    submit,
    submitting,
    succeeded,
  };
}
