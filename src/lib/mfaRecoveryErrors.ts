import { logError } from './logger';

/**
 * Controlled error model for the MFA recovery-codes client.
 *
 * Screens react to `issue`, never to a raw Firebase code. The backend
 * deliberately returns coarse errors (see
 * functions/src/mfaRecovery/generateRecoveryCodes.ts), and mirroring them
 * one-to-one in the UI would leak backend semantics into the presentation
 * layer.
 *
 * This module imports nothing from `firebase/functions`, so it stays testable
 * without the SDK — the same split `promoCodeErrors.ts` uses.
 *
 * NO MESSAGE HERE EVER CARRIES A RECOVERY CODE. There is no issue whose text,
 * name or logged context can contain one.
 */
export type MfaRecoveryIssue =
  /** No authenticated session, or the token was rejected. */
  | 'recoveryUnauthenticated'
  /**
   * The backend refused a precondition: authentication is too old, or TOTP is
   * not actually enrolled. Both are recoverable by the user, and the backend
   * deliberately does not distinguish them to the client.
   */
  | 'recoveryReauthRequired'
  /**
   * A concurrent generation won the compare-and-set. Retryable, and the ONE
   * issue the user should be told to simply try again.
   */
  | 'recoveryConflict'
  /** The device could not reach the backend. */
  | 'recoveryNetworkUnavailable'
  /** The response did not match the expected contract; nothing was shown. */
  | 'recoveryInvalidResponse'
  /** Anything else. */
  | 'recoveryGenerationFailed';

export class MfaRecoveryError extends Error {
  readonly issue: MfaRecoveryIssue;

  constructor(issue: MfaRecoveryIssue) {
    super(issue);
    this.name = 'MfaRecoveryError';
    this.issue = issue;
  }
}

export function isMfaRecoveryError(err: unknown): err is MfaRecoveryError {
  return err instanceof MfaRecoveryError;
}

/**
 * Issues the user can act on by simply trying the same thing again.
 *
 * `recoveryConflict` is the compare-and-set loser; the others are transient.
 * A retry is always MANUAL — an automatic retry loop against a generation
 * endpoint would burn recovery sets and defeat the concurrency guard.
 */
const RETRYABLE_ISSUES: readonly MfaRecoveryIssue[] = [
  'recoveryConflict',
  'recoveryNetworkUnavailable',
  'recoveryGenerationFailed',
];

export function isRetryableMfaRecoveryIssue(issue: MfaRecoveryIssue): boolean {
  return RETRYABLE_ISSUES.includes(issue);
}

/**
 * Maps a callable error code onto an issue.
 *
 * Kept exhaustive and explicit rather than defaulting silently, so a new
 * backend status has to be considered here instead of quietly becoming a
 * generic failure.
 */
export function mfaRecoveryIssueFromCallableCode(code: string): MfaRecoveryIssue {
  switch (code) {
    case 'unauthenticated':
      return 'recoveryUnauthenticated';
    case 'failed-precondition':
    case 'permission-denied':
      return 'recoveryReauthRequired';
    case 'aborted':
      return 'recoveryConflict';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'recoveryNetworkUnavailable';
    default:
      return 'recoveryGenerationFailed';
  }
}

/**
 * Callable status codes are a closed vocabulary of lowercase words. Anything
 * that does not match that shape is discarded rather than logged, so a
 * provider that ever puts free text in `code` cannot smuggle it into a log.
 */
const SAFE_CALLABLE_CODE = /^[a-z-]{1,32}$/;

/**
 * Logs a recovery failure.
 *
 * Takes an ISSUE, never an error object or a response. Passing the raw
 * rejection would risk serializing a callable result — and a successful
 * generation response contains ten plaintext recovery codes.
 *
 * `callableCode` is the OPTIONAL underlying status (`unauthenticated`,
 * `not-found`, …). It is included because without it every backend failure
 * looks identical in a device log, which makes a real incident — a missing
 * deploy, App Check enforcement, an expired token — impossible to tell apart.
 * It is safe: it is validated against a closed shape above, and a status code
 * describes the transport, never the account or the codes.
 */
export function logMfaRecoveryIssue(
  stage: string,
  issue: MfaRecoveryIssue,
  callableCode?: string,
): void {
  const safeCode =
    callableCode && SAFE_CALLABLE_CODE.test(callableCode) ? callableCode : undefined;

  logError(
    `mfaRecovery:${stage}${safeCode ? ` (${safeCode})` : ''}`,
    new MfaRecoveryError(issue),
  );
}
