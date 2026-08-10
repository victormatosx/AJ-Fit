"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logInfo = logInfo;
exports.logWarn = logWarn;
exports.logFunctionError = logFunctionError;
const v2_1 = require("firebase-functions/v2");
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
function errorCode(err) {
    return typeof err === 'object' && err !== null && 'code' in err
        ? String(err.code)
        : undefined;
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function logInfo(scope, message, context) {
    v2_1.logger.info(`[${scope}] ${message}`, context);
}
function logWarn(scope, message, context) {
    v2_1.logger.warn(`[${scope}] ${message}`, context);
}
function logFunctionError(scope, err, context) {
    v2_1.logger.error(`[${scope}]`, {
        code: errorCode(err),
        message: errorMessage(err),
        ...context,
    });
}
//# sourceMappingURL=logger.js.map