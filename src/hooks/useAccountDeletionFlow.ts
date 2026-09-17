import { useCallback, useRef, useState } from 'react';

import {
  getReauthenticationProviders,
  type ReauthenticationProvider,
} from '../lib/authProviders';
import {
  AccountDeletionReauthError,
  needsAccountDeletionReauthentication,
  startAccountDeletionReauthentication,
  type AccountDeletionReauthErrorCode,
} from '../services/accountDeletionReauth';
import { requestAccountDeletionWithProviderPreparation } from '../services/accountDeletionOrchestrator';
import { finalizeAccountDeletionClientShutdown } from '../services/accountDeletionShutdown';
import { ReauthenticationCancelledError } from '../services/reauthentication';
import { useAuth } from '../state/AuthContext';

/**
 * Owns the ENTIRE "Excluir Conta" flow's state — Fase 12. Screens
 * (`DeleteAccountScreen.tsx`) are presentation only, mirroring the
 * established hook/screen split: this hook is the
 * only place that talks to `accountDeletionReauth.ts`/
 * `accountDeletionOrchestrator.ts`/`accountDeletionShutdown.ts`.
 *
 * Deliberately reuses, never reimplements:
 *   - `accountDeletionReauth.ts` (Fase 2) for password/Google/Apple
 *     reauthentication.
 *   - `accountDeletionOrchestrator.ts` (Fase 3/5 correction) — the ONLY
 *     function that may call `requestAccountDeletion`. This hook never
 *     calls the callable directly.
 *   - `accountDeletionShutdown.ts` (Fase 5/11) for local cleanup + logout,
 *     called exactly once, only after the backend accepts the request.
 */

export type AccountDeletionFlowStep = 'intro' | 'reauth' | 'confirm' | 'submitting' | 'reconciliation';

export type AccountDeletionFlowIssue =
  | AccountDeletionReauthErrorCode
  | 'reauthCancelled'
  | 'googleRevocationFailed'
  // Fase 16: Apple cancellation now surfaces through the generic
  // 'USER_CANCELLED' (AccountDeletionReauthErrorCode) — cancelling the ONE
  // Apple sheet happens entirely inside `submitReauth` now, never inside
  // the orchestrator, so a separate "apple preparation cancelled" issue no
  // longer has a producer.
  | 'applePreparationUnavailable'
  | 'reconciliationRequired'
  | 'requestFailed'
  | 'appleValidationFailed';

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
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const operationLock = useRef(false);
  /**
   * Fase 16: the Apple `authorizationCode` captured (once) during
   * `submitReauth('apple')`, held ONLY in memory — never
   * AsyncStorage/SecureStore/Firestore/logged. Read-and-cleared by
   * `confirmDeletion` (single-use, never resent on retry) and wiped by
   * `reset()`/a non-Apple reauth completing (see their own call sites).
   */
  const appleAuthorizationCodeRef = useRef<string | null>(null);

  const reauthenticationProviders = getReauthenticationProviders(user);

  const resetSensitiveState = useCallback(() => {
    setReauthPasswordState('');
    setReauthProvider(null);
  }, []);

  const shutdownAcceptedDeletion = useCallback(async () => {
    if (!user) return;
    await finalizeAccountDeletionClientShutdown(user.uid, logout).catch(() => {
      // The accepted backend request remains authoritative even if local
      // cleanup cannot finish completely.
    });
  }, [user, logout]);

  const completeAcceptedDeletion = useCallback(async () => {
    if (operationLock.current) return;
    operationLock.current = true;
    try {
      await shutdownAcceptedDeletion();
    } finally {
      operationLock.current = false;
    }
  }, [shutdownAcceptedDeletion]);

  /** Called by the screen's `useScreenFocusEffect` cleanup — wipes everything transient, same discipline as `ChangePasswordScreen`. */
  const reset = useCallback(() => {
    setStepState('intro');
    setIssue(null);
    setSubmitting(false);
    setAccepted(false);
    appleAuthorizationCodeRef.current = null;
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
        // `undefined` for password/Google explicitly clears any leftover
        // material from an earlier, abandoned Apple attempt.
        appleAuthorizationCodeRef.current = outcome.appleAuthorizationCode ?? null;
        resetSensitiveState();
        setStepState('confirm');
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

  /** "Excluir minha conta" — the final, destructive confirmation. */
  const confirmDeletion = useCallback(async () => {
    if (operationLock.current) return;
    operationLock.current = true;
    setSubmitting(true);
    setStepState('submitting');
    setIssue(null);
    // Fase 16: consume-and-clear BEFORE the network call — single-use by
    // construction. Whether this attempt succeeds or fails, the ref is
    // already empty, so neither a retry nor a double-tap racing past
    // `operationLock` can ever resend the same (Apple-single-use) material.
    const preparedAppleAuthorizationCode = appleAuthorizationCodeRef.current;
    appleAuthorizationCodeRef.current = null;
    try {
      const result = await requestAccountDeletionWithProviderPreparation(preparedAppleAuthorizationCode);
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
            setStepState('reconciliation');
            return;
          }
          if (user) {
            await finalizeAccountDeletionClientShutdown(user.uid, logout).catch(() => {
              // The accepted backend request remains authoritative even if local
              // cleanup cannot complete immediately.
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
        case 'apple-material-missing':
          // Fase 16: apple.com is linked but no material was available for
          // this attempt (e.g. this screen was reached without ever
          // capturing Apple material, or an earlier attempt's material was
          // already consumed). This orchestrator never opens Apple itself
          // — only reauth can, so that's the only place to send the user.
          setIssue('applePreparationUnavailable');
          setStepState('reauth');
          return;
        case 'request-failed':
          if (result.code === 'failed-precondition' || result.code === 'unauthenticated') {
            // Recent-auth went stale between reauth and commit — send the
            // user back to reauthenticate, never a dead end (Fase 12 §36).
            // NEVER the code for an Apple exchange/config failure (Fase 15
            // incident) — the backend reserves `failed-precondition`/
            // `unauthenticated` exclusively for `requireRecentAuth` now.
            setIssue('SESSION_EXPIRED');
            setStepState('reauth');
            return;
          }
          if (result.code === 'aborted') {
            // Apple rejected the authorization code itself (Fase 15/16) —
            // the Firebase session is still fine, but the material was
            // already consumed-and-cleared above and Apple codes are
            // single-use regardless of outcome, so it can never be resent.
            // Fase 16: since the orchestrator no longer opens Apple itself,
            // recovering requires going back through reauth (which captures
            // fresh material), never staying on 'confirm'.
            setIssue('appleValidationFailed');
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
    completeAcceptedDeletion,
    confirmDeletion,
    continueToNextStep,
    issue,
    reauthenticationProviders,
    reauthPassword,
    reauthProvider,
    reset,
    setReauthPassword,
    setStep,
    step,
    submitReauth,
    submitting,
  };
}
