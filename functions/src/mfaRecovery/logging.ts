import { type LogContext, logInfo, logWarn } from '../lib/logger';
import type { RecoveryInternalCode } from './errors';

/**
 * MFA Recovery — logging policy.
 *
 * WHY A DEDICATED MODULE INSTEAD OF CALLING lib/logger DIRECTLY
 * ------------------------------------------------------------
 * `lib/logger.ts` sanitizes by DENY-LIST: it redacts keys that look like
 * secrets and masks known identifier keys. That is the right default for
 * billing and promo flows, where the field vocabulary is open-ended.
 *
 * It is the wrong default here. A deny-list fails open — a field nobody
 * anticipated (`selector`, `digest`, `hint`, `enteredCode`) passes straight
 * through. Recovery handles the one credential in the product that grants
 * MFA reset, so this module inverts the rule: an ALLOW-LIST, where anything
 * not explicitly named is dropped. A future contributor who adds a field to a
 * recovery log line gets silence, not a leak.
 *
 * Both layers run: this module filters, then delegates to `lib/logger`, which
 * applies its own sanitizer on the way out. Neither is modified by the other.
 *
 *
 * NEVER LOGGABLE, IN WHOLE OR IN PART
 * -----------------------------------
 * recovery code, any fragment or prefix of one, its digest, the pepper, a TOTP
 * code, the TOTP/QR secret, any Firebase ID token, refresh token or custom
 * token, a password, a Google or Apple credential, the user's email, and the
 * uid. None of these has a field name on the allow-list, so none can be
 * emitted through this module.
 *
 * The uid is excluded even though `lib/logger` would have masked it: a masked
 * uid on a recovery line still says "this specific account attempted MFA
 * recovery", which is exactly the sensitive fact. Correlation uses
 * `operationId` instead, which is random, server-minted and account-agnostic.
 *
 *
 * PHASE 1 SCOPE: policy and helpers. No recovery flow emits anything yet,
 * because no recovery flow exists.
 */

export const RECOVERY_LOG_SCOPE = 'mfaRecovery';

/** Stage of the (future) recovery pipeline that produced the event. */
export type RecoveryLogStage =
  | 'parse'
  | 'lookup'
  | 'verify'
  | 'rateLimit'
  | 'reserve'
  | 'reset'
  | 'revoke'
  | 'consume';

export type RecoveryLogOutcome = 'started' | 'succeeded' | 'rejected' | 'failed';

export interface RecoveryLogEvent {
  /** Coarse event name, e.g. `recovery.attempt`. A fixed literal at each call site. */
  readonly eventType: string;
  readonly stage: RecoveryLogStage;
  readonly outcome: RecoveryLogOutcome;
  /** Sanitized internal reason. Fixed constants only — see errors.ts. */
  readonly internalCode?: RecoveryInternalCode;
  /** Server-minted operation id; truncated to a correlation prefix below. */
  readonly operationId?: string;
  /** Attempt counter within the current rate-limit window. */
  readonly attempt?: number;
  readonly schemaVersion?: number;
}

/**
 * The complete set of emittable field names. Adding to this list is a security
 * review, not a routine change.
 */
export const RECOVERY_LOG_ALLOWED_FIELDS: readonly string[] = [
  'eventType',
  'stage',
  'outcome',
  'internalCode',
  'operationId',
  'attempt',
  'schemaVersion',
];

/**
 * How much of an operationId reaches a log line.
 *
 * The full id is not secret, but it is a precise handle on one recovery
 * attempt, and log retention outlives the attempt by a long way. A short
 * prefix is enough to stitch a single pipeline together in Cloud Logging while
 * being useless for linking attempts across time.
 */
const OPERATION_ID_LOG_PREFIX_LENGTH = 8;

function operationCorrelationId(operationId: string): string {
  return operationId.slice(0, OPERATION_ID_LOG_PREFIX_LENGTH);
}

/**
 * Projects an event onto the allow-list.
 *
 * Exported so tests can assert the filtering directly, and so a reviewer can
 * see that the returned object is BUILT from named fields rather than
 * filtered from an arbitrary input — there is no path by which an unlisted
 * key reaches the result.
 */
export function buildRecoveryLogContext(event: RecoveryLogEvent): LogContext {
  const context: LogContext = {
    eventType: event.eventType,
    stage: event.stage,
    outcome: event.outcome,
  };

  if (event.internalCode !== undefined) {
    context.internalCode = event.internalCode;
  }
  if (event.operationId !== undefined) {
    context.operationId = operationCorrelationId(event.operationId);
  }
  if (event.attempt !== undefined) {
    context.attempt = event.attempt;
  }
  if (event.schemaVersion !== undefined) {
    context.schemaVersion = event.schemaVersion;
  }

  return context;
}

/**
 * Emits a recovery event.
 *
 * `rejected` and `failed` go to warn so that a spike in refused recovery
 * attempts is visible without having to query info-level logs; everything else
 * is info. Nothing here logs at error level with an exception attached — a
 * raw error object could carry a message assembled elsewhere, and recovery
 * lines are built from named fields only.
 */
export function logRecoveryEvent(event: RecoveryLogEvent): void {
  const context = buildRecoveryLogContext(event);
  const message = `${event.stage}:${event.outcome}`;

  if (event.outcome === 'rejected' || event.outcome === 'failed') {
    logWarn(RECOVERY_LOG_SCOPE, message, context);
    return;
  }

  logInfo(RECOVERY_LOG_SCOPE, message, context);
}
