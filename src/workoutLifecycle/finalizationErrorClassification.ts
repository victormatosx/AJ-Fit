import { errorCode } from '../lib/logger';

/**
 * User-facing failure buckets for the finalize-workout callable. Deliberately
 * coarser than the server's `safeReasonCode` — that stays a diagnostic detail
 * in logs; this is the only thing the retry UI is allowed to branch on.
 *
 * `CARDIO_COMPLETION_REQUIRED` is split out of the generic `VALIDATION`
 * bucket on purpose: unlike every other business-rule rejection, it is one
 * the user can act on directly from the error surface (finish the pending
 * cardio), so it gets its own copy and CTA instead of a plain retry that
 * would just resend the same incomplete payload and fail again.
 */
export type WorkoutFinalizationErrorCategory =
  | 'OFFLINE' | 'TIMEOUT' | 'CARDIO_COMPLETION_REQUIRED' | 'VALIDATION' | 'UNKNOWN';

const OFFLINE_CODES = new Set(['functions/unavailable', 'unavailable']);
const TIMEOUT_CODES = new Set(['functions/deadline-exceeded', 'deadline-exceeded']);
const FAILED_PRECONDITION_CODES = new Set(['functions/failed-precondition', 'failed-precondition']);
// Business-rule rejections (e.g. schedule mismatch, early-finish with no
// completed set): retry-safe and idempotent, but retrying alone won't change
// the outcome unless the input that caused them changes too.
const VALIDATION_CODES = new Set([
  'functions/failed-precondition', 'failed-precondition',
  'functions/permission-denied', 'permission-denied',
  'functions/invalid-argument', 'invalid-argument',
]);

// Verbatim HttpsError message thrown by `finalizeWorkoutSession.ts` on the
// backend (`functions/src/workoutLifecycle/finalizeWorkoutSession.ts`) —
// rethrown unmodified through every catch there, so it reaches the client as
// `FunctionsError.message` exactly as written here.
const CARDIO_COMPLETION_REQUIRED_MESSAGE = 'cardio_completion_required';

function errorMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) return undefined;
  const raw = (error as { message?: unknown }).message;
  return typeof raw === 'string' ? raw : undefined;
}

export function classifyWorkoutFinalizationError(error: unknown): WorkoutFinalizationErrorCategory {
  const code = errorCode(error);
  if (!code) return 'UNKNOWN';
  if (OFFLINE_CODES.has(code)) return 'OFFLINE';
  if (TIMEOUT_CODES.has(code)) return 'TIMEOUT';
  if (FAILED_PRECONDITION_CODES.has(code) && errorMessage(error) === CARDIO_COMPLETION_REQUIRED_MESSAGE) {
    return 'CARDIO_COMPLETION_REQUIRED';
  }
  if (VALIDATION_CODES.has(code)) return 'VALIDATION';
  return 'UNKNOWN';
}
