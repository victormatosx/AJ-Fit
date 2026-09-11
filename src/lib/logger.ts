type LogContext = Record<string, unknown>;

const SECRET_KEY = /(token|receipt|jws|secret|password|credential|authorization|coupon|promo_?code|signed_?url|object_?path)/i;
const IDENTIFIER_KEYS = new Set([
  'uid',
  'userid',
  'appuserid',
  'originalappuserid',
  'adminuid',
  'eventid',
  'lasteventid',
  'transactionid',
  'originaltransactionid',
  'photoid',
  'questionnaireid',
  'installationid',
]);

function maskIdentifier(value: string): string {
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

export function sanitizeLogText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/\$RCAnonymousID:[\w-]+/g, '$RCAnonymousID:[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(
      /\b[A-Za-z0-9_-]*(?:password|passwd|senha|credential|authorization|bearer|secret|token)[A-Za-z0-9_-]*\b/gi,
      '[redacted]',
    )
    .replace(/\b[A-Za-z0-9+/=_-]{48,}\b/g, '[redacted-value]')
    .replace(
      /\b(?=[A-Za-z0-9_-]{20,47}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]+\b/g,
      '[redacted-id]',
    )
    .slice(0, 320);
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    if (IDENTIFIER_KEYS.has(key.replace(/_/g, '').toLowerCase())) return maskIdentifier(value);
    if (/url/i.test(key)) return '[redacted-url]';
    return sanitizeLogText(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(key, item));
  if (value instanceof Error) return sanitizeError(value);
  if (typeof value === 'object') return sanitizeLogContext(value as LogContext);
  return String(value);
}

export function sanitizeLogContext(context?: LogContext): LogContext | undefined {
  if (!context) return undefined;
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, sanitizeValue(key, value)]),
  );
}

/** Safe, allowlist-validated error identifier (e.g. a Firestore `code` like `failed-precondition`) — never the raw error object/message. */
export function errorCode(err: unknown): string | undefined {
  const raw =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  return /^[a-z0-9/_-]{1,64}$/i.test(raw) ? raw : undefined;
}

/** Safe callable `details.reason` enum; arbitrary details payloads are never logged. */
export function errorReason(err: unknown): string | undefined {
  const details = typeof err === 'object' && err !== null && 'details' in err
    ? (err as { details?: unknown }).details : null;
  const raw = typeof details === 'object' && details !== null && 'reason' in details
    ? String((details as { reason?: unknown }).reason) : '';
  return /^[a-z0-9_/-]{1,96}$/i.test(raw) ? raw : undefined;
}

/** Constructor name only (e.g. `FirebaseError`, `TypeError`) — never the message/stack. */
export function errorClass(err: unknown): string {
  if (err instanceof Error) return err.constructor.name || 'Error';
  return typeof err;
}

function sanitizeError(err: unknown): { code?: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  return { code: errorCode(err), message: sanitizeLogText(raw) };
}

function isDevelopment(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function logDebug(scope: string, message: string, context?: LogContext): void {
  if (!isDevelopment()) return;
  const safeContext = sanitizeLogContext(context);
  const line = `[${sanitizeLogText(scope)}] ${sanitizeLogText(message)}`;
  safeContext
    ? console.debug(line, safeContext)
    : console.debug(line);
}

export function logInfo(scope: string, message: string, context?: LogContext): void {
  if (!isDevelopment()) return;
  const safeContext = sanitizeLogContext(context);
  const line = `[${sanitizeLogText(scope)}] ${sanitizeLogText(message)}`;
  safeContext
    ? console.info(line, safeContext)
    : console.info(line);
}

export function logWarn(scope: string, message: string, context?: LogContext): void {
  const safeContext = sanitizeLogContext(context);
  const line = `[${sanitizeLogText(scope)}] ${sanitizeLogText(message)}`;
  safeContext
    ? console.warn(line, safeContext)
    : console.warn(line);
}

export function logError(scope: string, err: unknown, context?: LogContext): void {
  console.error(`[${sanitizeLogText(scope)}]`, {
    ...sanitizeLogContext(context),
    ...sanitizeError(err),
  });
}
