import { logger } from 'firebase-functions/v2';

/**
 * Structured logging for the Cloud Functions backend, mirroring the
 * `[scope]` convention already used on the client
 * (src/lib/logError.ts / src/services/auth.ts's `logAuthError`) so logs read
 * consistently across the whole codebase. Uses `firebase-functions/v2`'s
 * logger instead of `console.*` so entries land in Cloud Logging with proper
 * severity levels.
 *
 * Never pass email, name, tokens, credentials, secrets, vault keys, photo
 * content, signed URLs or raw object paths as context. Photo Vault also avoids
 * user IDs and photo IDs; billing uses only the already-established masked or
 * operational identifiers documented in its handlers.
 */

type LogValue = string | number | boolean | null | undefined;
export type LogContext = Record<string, LogValue | readonly LogValue[]>;

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

export function logFunctionError(
  scope: string,
  err: unknown,
  context?: LogContext,
): void {
  logger.error(`[${scope}]`, {
    code: errorCode(err),
    ...context,
  });
}
