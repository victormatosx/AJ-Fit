import { logger } from 'firebase-functions/v2';

/**
 * Structured logging for the Cloud Functions backend, using
 * `firebase-functions/v2`'s logger (not `console.*`) so entries land in
 * Cloud Logging with proper severity levels.
 *
 * SECURITY — never pass any of the following as `context`, ever, in any
 * function added to this backend:
 *   - Firebase ID Tokens or `Authorization` header values
 *   - Vault Keys (wrapped or unwrapped), KMS ciphertext/plaintext
 *   - full photo ciphertext or any photo content
 *   - signed/private Storage URLs
 *   - secrets or service credentials
 * Photo Vault logs also avoid user IDs, object paths and photo IDs. Aggregate
 * counters, a fixed stage and a short provider code are sufficient for its
 * operational diagnostics.
 */
export type LogContext = Record<string, string | number | boolean | null | undefined>;

function errorCode(err: unknown): string {
  const raw =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  return /^[a-z0-9/_-]{1,64}$/i.test(raw) ? raw : 'UNCLASSIFIED';
}

export function logInfo(scope: string, message: string, context?: LogContext): void {
  logger.info(`[${scope}] ${message}`, context);
}

export function logWarn(scope: string, message: string, context?: LogContext): void {
  logger.warn(`[${scope}] ${message}`, context);
}

export function logFunctionError(scope: string, err: unknown, context?: LogContext): void {
  logger.error(`[${scope}]`, {
    code: errorCode(err),
    ...context,
  });
}
