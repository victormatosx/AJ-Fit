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
 * A `uid` alone is fine (Cloud Functions logs are ops-only, not
 * user-facing) — see docs/12_seguranca_geral_do_app.md.
 */
export type LogContext = Record<string, string | number | boolean | null | undefined>;

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
    message: errorMessage(err),
    ...context,
  });
}
