/**
 * Structured console logging for non-fatal failures, matching the existing
 * `[auth:scope]` convention from src/services/auth.ts's `logAuthError` —
 * generalized here so other modules (Firestore reads/writes outside auth)
 * follow the same shape instead of ad-hoc `console.error(...)` calls.
 *
 * This project has no remote crash/error reporting configured (no Sentry,
 * no Firebase Crashlytics, no custom log service — confirmed absent as of
 * docs/08_log_de_evolucao.md). These logs are only visible in a connected
 * debugger/Metro console, NEVER in a production build a user is running.
 * That gap is registered as a production pendency, not solved here (no new
 * dependency added per this round's scope).
 *
 * Never pass user-identifying data (email, name, uid) as `context` — scope
 * + error code/message is enough to triage without logging PII.
 */
export function logError(scope: string, err: unknown, context?: Record<string, unknown>): void {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : undefined;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${scope}]`, { code, message, ...context });
}
