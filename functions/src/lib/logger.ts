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

const SECRET_KEY = /(token|receipt|jws|secret|password|credential|authorization|coupon|signed_?url|object_?path)/i;
const IDENTIFIER_KEYS = new Set([
  'uid',
  'userid',
  'appuserid',
  'adminuid',
  'eventid',
  'lasteventid',
  'transactionid',
  'originaltransactionid',
  'installationid',
]);

function maskIdentifier(value: string): string {
  if (value.length <= 6) return '***';
  if (value.includes('…')) return value;
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

function sanitizedValue(key: string, value: LogValue): LogValue {
  if (value === undefined || value === null || typeof value !== 'string') return value;
  if (SECRET_KEY.test(key) || key.toLowerCase() === 'code') return '[redacted]';
  if (IDENTIFIER_KEYS.has(key.replace(/_/g, '').toLowerCase())) return maskIdentifier(value);
  return value;
}

export function sanitizeLogContext(context?: LogContext): LogContext | undefined {
  if (!context) return undefined;
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map((item) => sanitizedValue(key, item))
        : sanitizedValue(key, value as LogValue),
    ]),
  );
}

function errorCode(err: unknown): string {
  const raw =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  return /^[a-z0-9/_-]{1,64}$/i.test(raw) ? raw : 'UNCLASSIFIED';
}

export function logInfo(scope: string, message: string, context?: LogContext): void {
  logger.info(`[${scope}] ${message}`, sanitizeLogContext(context));
}

export function logWarn(scope: string, message: string, context?: LogContext): void {
  logger.warn(`[${scope}] ${message}`, sanitizeLogContext(context));
}

export function logFunctionError(
  scope: string,
  err: unknown,
  context?: LogContext,
): void {
  logger.error(`[${scope}]`, {
    ...sanitizeLogContext(context),
    // Context can contain a promo-code field named `code`; it must never
    // replace the standardized provider error code.
    code: errorCode(err),
  });
}
