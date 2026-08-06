import { logger as functionsLogger } from 'firebase-functions/v2';

/**
 * Structured logging for the Cloud Functions backend, mirroring the
 * `[scope]` convention already used on the client
 * (src/lib/logError.ts / src/services/auth.ts's `logAuthError`) so logs read
 * consistently across the whole codebase. Uses `firebase-functions/v2`'s
 * logger instead of `console.*` so entries land in Cloud Logging with proper
 * severity levels.
 *
 * Never pass user-identifying data (email, name) as `context` — a `uid` is
 * fine (Cloud Functions logs are already ops-only, not user-facing), but
 * keep PII out per docs/12_seguranca_geral_do_app.md.
 */

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function logInfo(scope: string, message: string, context?: Record<string, unknown>): void {
  functionsLogger.info(`[${scope}] ${message}`, context);
}

export function logWarn(scope: string, message: string, context?: Record<string, unknown>): void {
  functionsLogger.warn(`[${scope}] ${message}`, context);
}

export function logFunctionError(
  scope: string,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  functionsLogger.error(`[${scope}]`, {
    code: errorCode(err),
    message: errorMessage(err),
    ...context,
  });
}
