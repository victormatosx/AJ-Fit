import { useCallback, useRef, useState } from 'react';

import {
  isRetryableMfaRecoveryIssue,
  isMfaRecoveryError,
  type MfaRecoveryIssue,
} from '../lib/mfaRecoveryErrors';
import { MfaTotpServiceError } from '../services/mfaTotp';
import {
  finishTotpReauthentication,
  startTotpReauthentication,
  type TotpReauthenticationChallenge,
} from '../services/mfaTotp';
import { generateRecoveryCodes } from '../services/mfaRecovery';
import type { MfaTotpIssue } from '../lib/mfaTotp';
import type { ReauthenticationRequest } from '../services/reauthentication';

/**
 * Owns the generation + reveal lifecycle of MFA recovery codes.
 *
 *
 * WHERE THE PLAINTEXT LIVES
 * -------------------------
 * In `codes`, in React state, and nowhere else. There is no persistence call
 * anywhere in this file and no ref that survives `clear()`. The screen is
 * responsible for calling `clear()` when it deactivates, unmounts, or is
 * abandoned — mirroring how `useTotpEnrollment` wipes the enrollment secret.
 *
 *
 * WHY GENERATION IS NOT AUTOMATIC ON MOUNT
 * ----------------------------------------
 * `generate()` is called explicitly, once, by the flow that owns it. A
 * generation is a state-changing operation that rotates any previous set —
 * firing it from an effect would make a re-render or a Fast Refresh silently
 * invalidate a user's codes.
 *
 *
 * DOUBLE-SUBMIT
 * -------------
 * `busy` gates the UI and `inFlight` gates the function itself, because a
 * disabled button is not a guarantee. Neither is the real protection: the
 * backend's compare-and-set is (see the Phase 2B design). This only avoids
 * pointless conflicts.
 */

export type RecoveryCodesIssue = MfaRecoveryIssue | MfaTotpIssue;

export type RecoveryCodesStatus =
  /** Nothing requested yet. */
  | 'idle'
  /** Reauthentication needed before generating (regeneration path). */
  | 'reauthRequired'
  /** Firebase demanded a TOTP code to complete the reauthentication. */
  | 'reauthChallenge'
  /** Codes are in memory and on screen. */
  | 'ready'
  /** Generation failed; `issue` explains, `retryable` says whether to retry. */
  | 'failed';

export function useRecoveryCodes() {
  const [status, setStatus] = useState<RecoveryCodesStatus>('idle');
  const [codes, setCodes] = useState<string[]>([]);
  const [issue, setIssue] = useState<RecoveryCodesIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const inFlight = useRef(false);
  const challengeRef = useRef<TotpReauthenticationChallenge | null>(null);

  const toIssue = useCallback((err: unknown): RecoveryCodesIssue => {
    if (isMfaRecoveryError(err)) return err.issue;
    if (err instanceof MfaTotpServiceError) return err.issue;
    return 'recoveryGenerationFailed';
  }, []);

  /**
   * Drops every trace of the plaintext.
   *
   * Also clears the resolver: a `MultiFactorResolver` is a live credential
   * handle, not just data.
   */
  const clear = useCallback(() => {
    setCodes([]);
    setStatus('idle');
    setIssue(null);
    setBusy(false);
    setConfirmed(false);
    challengeRef.current = null;
    inFlight.current = false;
  }, []);

  /** Calls the backend and reveals the result. Never persists anything. */
  const generate = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setIssue(null);

    try {
      const result = await generateRecoveryCodes();
      setCodes(result.codes);
      setStatus('ready');
      return true;
    } catch (err) {
      // The error object is never stored or logged here — the service already
      // logged a sanitized issue, and holding the rejection risks carrying a
      // response body (ten plaintext codes) into a crash report.
      setIssue(toIssue(err));
      setStatus('failed');
      setCodes([]);
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [toIssue]);

  /**
   * Regeneration entry point: prove identity first, then generate.
   *
   * Reuses the shared reauthentication machinery, so an account with TOTP
   * enrolled is still challenged for a TOTP code — generating the codes that
   * replace a second factor must never be possible with the first factor
   * alone.
   */
  const reauthenticateAndGenerate = useCallback(
    async (request: ReauthenticationRequest): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setIssue(null);

      try {
        const outcome = await startTotpReauthentication(request);

        if (outcome.status === 'challenge') {
          challengeRef.current = outcome.challenge;
          setStatus('reauthChallenge');
          return false;
        }

        challengeRef.current = null;
      } catch (err) {
        setIssue(toIssue(err));
        setStatus('failed');
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }

      return generate();
    },
    [generate, toIssue],
  );

  /** Completes the TOTP challenge, then generates. */
  const submitReauthCode = useCallback(
    async (code: string): Promise<boolean> => {
      const challenge = challengeRef.current;
      if (!challenge || inFlight.current) return false;

      inFlight.current = true;
      setBusy(true);
      setIssue(null);

      try {
        await finishTotpReauthentication(challenge, code);
        challengeRef.current = null;
      } catch (err) {
        setIssue(toIssue(err));
        // A wrong code is retryable in place; the challenge stays alive.
        setBusy(false);
        inFlight.current = false;
        return false;
      }

      inFlight.current = false;
      setBusy(false);
      return generate();
    },
    [generate, toIssue],
  );

  const cancelReauth = useCallback(() => {
    challengeRef.current = null;
    setStatus('idle');
    setIssue(null);
    setBusy(false);
  }, []);

  return {
    status,
    codes,
    issue,
    busy,
    confirmed,
    /** Only `failed` states the user can act on by trying again. */
    retryable: issue ? isRetryableMfaRecoveryIssue(issue as MfaRecoveryIssue) : false,
    hasCodes: codes.length > 0,
    setConfirmed,
    generate,
    reauthenticateAndGenerate,
    submitReauthCode,
    cancelReauth,
    clear,
    requireReauth: useCallback(() => {
      setStatus('reauthRequired');
      setIssue(null);
    }, []),
  };
}
