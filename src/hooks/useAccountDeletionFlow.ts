import { useCallback, useRef, useState } from 'react';

import {
  getReauthenticationProviders,
  type ReauthenticationProvider,
} from '../lib/authProviders';
import { validateTotpCode } from '../lib/mfaTotp';
import {
  AccountDeletionReauthError,
  finishAccountDeletionReauthentication,
  needsAccountDeletionReauthentication,
  startAccountDeletionReauthentication,
  type AccountDeletionMfaChallenge,
  type AccountDeletionReauthErrorCode,
} from '../services/accountDeletionReauth';
import { requestAccountDeletionWithProviderPreparation } from '../services/accountDeletionOrchestrator';
import { finalizeAccountDeletionClientShutdown } from '../services/accountDeletionShutdown';
import { ReauthenticationCancelledError } from '../services/reauthentication';
import { useAuth } from '../state/AuthContext';

/**
 * Owns the ENTIRE "Excluir Conta" flow's state — Fase 12. Screens
 * (`DeleteAccountScreen.tsx`) are presentation only, mirroring the
 * established `useChangePassword`/`useTotpMfa` pattern: this hook is the
 * only place that talks to `accountDeletionReauth.ts`/
 * `accountDeletionOrchestrator.ts`/`accountDeletionShutdown.ts`.
 *
 * Deliberately reuses, never reimplements:
 *   - `accountDeletionReauth.ts` (Fase 2) for password/Google/Apple/MFA
 *     reauthentication.
 *   - `accountDeletionOrchestrator.ts` (Fase 3/5 correction) — the ONLY
 *     function that may call `requestAccountDeletion`. This hook never
 *     calls the callable directly.
 *   - `accountDeletionShutdown.ts` (Fase 5/11) for local cleanup + logout,
 *     called exactly once, only after the backend accepts the request.
 */

export type AccountDeletionFlowStep = 'intro' | 'reauth' | 'confirm' | 'submitting';

export type AccountDeletionFlowIssue =
  | AccountDeletionReauthErrorCode
  | 'reauthCancelled'
  | 'googleRevocationFailed'
  | 'applePreparationCancelled'
  | 'applePreparationUnavailable'
  | 'reconciliationRequired'
  | 'requestFailed';

function issueFromReauthError(error: unknown): AccountDeletionFlowIssue {
  if (error instanceof ReauthenticationCancelledError) return 'reauthCancelled';
  if (error instanceof AccountDeletionReauthError) return error.code;
  return 'REAUTH_FAILED';
}

export function useAccountDeletionFlow() {
  const { user, logout } = useAuth();

  const [step, setStepState] = useState<AccountDeletionFlowStep>('intro');
  const [issue, setIssue] = useState<AccountDeletionFlowIssue | null>(null);
  const [reauthProvider, setReauthProvider] = useState<ReauthenticationProvider | null>(null);
  const [reauthPassword, setReauthPasswordState] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState<AccountDeletionMfaChallenge | null>(null);
  const [mfaCode, setMfaCodeState] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const operationLock = useRef(false);

  const reauthenticationProviders = getReauthenticationProviders(user);

  const resetSensitiveState = useCallback(() => {
    setReauthPasswordState('');
    setMfaCodeState('');
    setMfaChallenge(null);
    setReauthProvider(null);
  }, []);

  /** Called by the screen's `useScreenFocusEffect` cleanup — wipes everything transient, same discipline as `ChangePasswordScreen`. */
  const reset = useCallback(() => {
    setStepState('intro');
    setIssue(null);
    setSubmitting(false);
    setAccepted(false);
    resetSensitiveState();
  }, [resetSensitiveState]);

  const setStep = useCallback((next: AccountDeletionFlowStep) => {
    setIssue(null);
    setStepState(next);
  }, []);

  const setReauthPassword = useCallback((value: string) => {
    setReauthPasswordState(value);
    setIssue(null);
  }, []);

  const setMfaCode = useCallback((value: string) => {
    setMfaCodeState(value.replace(/\D/g, '').slice(0, 6));
    setIssue(null);
  }, []);

  /** "Continuar com exclusão" from the intro/consequences step. */
  const continueToNextStep = useCallback(async () => {
    if (operationLock.current) return;
    operationLock.current = true;
    setIssue(null);
    try {
      const needsReauth = await needsAccountDeletionReauthentication();
      setStepState(needsReauth ? 'reauth' : 'confirm');
    } finally {
      operationLock.current = false;
    }
  }, []);

  const submitReauth = useCallback(
    async (provider: ReauthenticationProvider) => {
      if (operationLock.current) return;
      if (provider === 'password' && !reauthPassword) {
        setIssue('PASSWORD_REQUIRED');
        return;
      }
      operationLock.current = true;
      setReauthProvider(provider);
      setIssue(null);
      try {
        const request =
          provider === 'password' ? ({ provider, password: reauthPassword } as const) : ({ provider } as const);
        const outcome = await startAccountDeletionReauthentication(request);
        setReauthPasswordState('');
        if (outcome.status === 'challenge') {
          setMfaChallenge(outcome.challenge);
          setMfaCodeState('');
        } else {
          resetSensitiveState();
          setStepState('confirm');
        }
      } catch (error) {
        setReauthPasswordState('');
        setIssue(issueFromReauthError(error));
      } finally {
        operationLock.current = false;
        setReauthProvider(null);
      }
    },
    [reauthPassword, resetSensitiveState],
  );

  const submitMfaCode = useCallback(async () => {
    if (operationLock.current || !mfaChallenge) return;
    if (validateTotpCode(mfaCode)) {
      setIssue('MFA_INVALID_CODE');
      return;
    }
    operationLock.current = true;
    setIssue(null);
    try {
      // A TOTP resolver may list more than one enrolled factor; the flow
      // only ever offers the first hint — same simplification already
      // accepted for other single-factor UI in this app (mirrors the "no
      // factor picker" scope of `useTotpMfa`'s own disable flow when only
      // one factor is relevant to the operation).
      const hintUid = mfaChallenge.hints[0]?.uid;
      if (!hintUid) {
        setIssue('MFA_INVALID_CODE');
        return;
      }
      await finishAccountDeletionReauthentication(mfaChallenge, hintUid, mfaCode);
      resetSensitiveState();
      setStepState('confirm');
    } catch (error) {
      setMfaCodeState('');
      setIssue(issueFromReauthError(error));
    } finally {
      operationLock.current = false;
    }
  }, [mfaChallenge, mfaCode, resetSensitiveState]);

  const cancelMfa = useCallback(() => {
    if (operationLock.current) return;
    resetSensitiveState();
    setIssue(null);
  }, [resetSensitiveState]);

  /** "Excluir minha conta" — the final, destructive confirmation. */
  const confirmDeletion = useCallback(async () => {
    if (operationLock.current) return;
    operationLock.current = true;
    setSubmitting(true);
    setStepState('submitting');
    setIssue(null);
    try {
      const result = await requestAccountDeletionWithProviderPreparation();
      switch (result.status) {
        case 'accepted': {
          setAccepted(true);
          if (result.requiresReconciliation) {
            // Fase 12 §35: an existing FAILED_TERMINAL operation was found —
            // no NEW operation was created. Still shut the client down
            // (the backend lock already applies regardless — Fase 5 §63),
            // but this is surfaced, never silently promised as a fresh
            // success.
            setIssue('reconciliationRequired');
          }
          if (user) {
            await finalizeAccountDeletionClientShutdown(user.uid, logout).catch(() => {
              // Best-effort — the backend is already authoritative
              // (Fase 5 §63/Fase 12 §25). Local cleanup failing here must
              // never "cancel" an accepted deletion.
            });
          }
          return;
        }
        case 'identity-changed':
          setIssue('IDENTITY_CHANGED');
          setStepState('intro');
          return;
        case 'google-revocation-failed':
          setIssue('googleRevocationFailed');
          setStepState('confirm');
          return;
        case 'apple-preparation-cancelled':
          setIssue('applePreparationCancelled');
          setStepState('confirm');
          return;
        case 'apple-preparation-unavailable':
          setIssue('applePreparationUnavailable');
          setStepState('confirm');
          return;
        case 'request-failed':
          if (result.code === 'failed-precondition' || result.code === 'unauthenticated') {
            // Recent-auth (or Apple material) went stale between reauth and
            // commit — send the user back to reauthenticate, never a dead
            // end (Fase 12 §36).
            setIssue('SESSION_EXPIRED');
            setStepState('reauth');
            return;
          }
          setIssue('requestFailed');
          setStepState('confirm');
          return;
      }
    } finally {
      operationLock.current = false;
      setSubmitting(false);
    }
  }, [logout, user]);

  return {
    accepted,
    cancelMfa,
    confirmDeletion,
    continueToNextStep,
    issue,
    mfaChallenge,
    mfaCode,
    reauthenticationProviders,
    reauthPassword,
    reauthProvider,
    reset,
    setReauthPassword,
    setMfaCode,
    setStep,
    step,
    submitMfaCode,
    submitReauth,
    submitting,
  };
}
