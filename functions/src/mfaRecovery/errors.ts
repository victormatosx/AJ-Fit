/**
 * MFA Recovery — error taxonomy.
 *
 * TWO LAYERS, DELIBERATELY ASYMMETRIC
 * -----------------------------------
 * Recovery is reached by a caller who has passed the FIRST factor but has not
 * completed MFA — i.e. by someone we cannot yet treat as the account owner.
 * Every distinction we surface there is a distinction an attacker can probe.
 * "no such account", "account exists but has no recovery set", "recovery set
 * exists but that code is wrong" would together turn the recovery endpoint
 * into an account-enumeration oracle and a recovery-set oracle.
 *
 * So the PUBLIC surface is exactly one code — `recovery-unavailable` — and it
 * is returned for every failure, including malformed input, unknown selector,
 * wrong digest, exhausted set, rate limiting and internal faults. The caller
 * learns only "this did not work".
 *
 * The INTERNAL codes below exist purely for observability. They are sanitized
 * by construction (fixed, non-parameterized string constants — they can never
 * carry a code, a digest, a uid or an email) and they must never travel to the
 * client. `toPublicRecoveryError` is the one-way door.
 *
 * PHASE 1 SCOPE: taxonomy only. Nothing here throws from a callable, because
 * no recovery callable exists yet.
 */

/**
 * The single public error code for the whole recovery surface.
 *
 * Adding a second public code is a security decision, not a UX decision: any
 * new code must be provably unable to distinguish "this account/set exists"
 * from "it does not". See docs note in the Phase 1 report — a dedicated
 * rate-limit code is an open Phase 2 question for exactly this reason.
 */
export const RECOVERY_PUBLIC_ERROR_CODE = 'mfa-recovery/recovery-unavailable' as const;

export type RecoveryPublicErrorCode = typeof RECOVERY_PUBLIC_ERROR_CODE;

/**
 * Internal, log-only failure reasons.
 *
 * Every value is a fixed constant with no interpolation slot, which is what
 * makes it safe to persist on a RecoveryOperation and to emit to Cloud
 * Logging without a sanitizer pass.
 */
export type RecoveryInternalCode =
  /** Input did not parse as an AJ Fit recovery code (prefix/length/alphabet). */
  | 'MALFORMED_CODE'
  /** No recovery set exists for the selector carried by the code. */
  | 'RECOVERY_SET_NOT_FOUND'
  /** The set exists but is `rotated` or `exhausted`, so it cannot authorize. */
  | 'RECOVERY_SET_NOT_ACTIVE'
  /** The set exists but holds no code whose digest matches. */
  | 'CODE_NOT_FOUND'
  /** The matched code was already consumed by a previous, finished operation. */
  | 'CODE_ALREADY_CONSUMED'
  /** The matched code is reserved by a DIFFERENT in-flight operation. */
  | 'CODE_ALREADY_RESERVED'
  /** A second reset was attempted while one was still in flight. */
  | 'OPERATION_CONFLICT'
  /** A state transition outside the declared machine was attempted. */
  | 'INVALID_STATE_TRANSITION'
  /** The persisted document failed the closed-schema check. */
  | 'INVALID_RECOVERY_SET'
  /** The HMAC pepper was absent or too short to be used. */
  | 'PEPPER_UNAVAILABLE'
  /** Per-set attempt budget exhausted. */
  | 'RATE_LIMITED';

/**
 * Internal recovery failure.
 *
 * `message` is intentionally just the internal code: there is no `detail`
 * parameter, so no call site can accidentally append a recovery code, a
 * digest, an email or a uid to an error that may end up in a log.
 */
export class RecoveryError extends Error {
  readonly internalCode: RecoveryInternalCode;

  /** Always the same value — kept on the instance so callers cannot forget it. */
  readonly publicCode: RecoveryPublicErrorCode = RECOVERY_PUBLIC_ERROR_CODE;

  constructor(internalCode: RecoveryInternalCode) {
    super(internalCode);
    this.name = 'RecoveryError';
    this.internalCode = internalCode;
  }
}

export function isRecoveryError(err: unknown): err is RecoveryError {
  return err instanceof RecoveryError;
}

/**
 * Collapses ANY error into the single public code.
 *
 * Non-`RecoveryError` failures (a Firestore outage, a bug) collapse to the
 * same value: an unexpected exception must not become a side channel either.
 */
export function toPublicRecoveryError(_err: unknown): RecoveryPublicErrorCode {
  return RECOVERY_PUBLIC_ERROR_CODE;
}
