import { logDebug } from './logger';

/**
 * TEMPORARY development-only trace of the Photo Vault save flow.
 *
 * WHY THIS EXISTS
 *
 * Saving the first photos can end with the vault back in its locked state and
 * nothing persisted. Static reading narrowed the possible causes but could not
 * prove which one fires on a real device, because every candidate produces the
 * same visible outcome. This module exists to reconstruct an exact timeline
 * from a physical-device reproduction, and for nothing else.
 *
 * THIS IS NOT A PRODUCT FEATURE. It must be removed once the cause is proven —
 * `src/state/__tests__/photoVaultContextStructure.test.ts` already asserts that
 * temporary lifecycle diagnostics do not survive in the provider source, and
 * the same expectation applies to every call site wired to this module.
 *
 * WHAT MAY BE TRACED
 *
 * A closed vocabulary of non-identifying values only:
 *
 *   - lifecycle states (`locked`/`unlocked`, `active`/`background`, …);
 *   - closed enums already safe to log (a pose, a `PhotoVaultIssue`, a
 *     sanitized provider code);
 *   - durations, counts, booleans and the synthetic attempt id below.
 *
 * Never a URI, never file bytes or sizes of a user's photo, never key
 * material, never a uid, photoId or assetId. Output also passes through
 * `logDebug`, which is `__DEV__`-gated and sanitizes its context, so this
 * module cannot emit anything in a release bundle even if a call site is wrong.
 *
 * CORRELATION
 *
 * Async work crosses four modules, so every line carries `attempt` — a
 * process-local counter (`save-1`, `save-2`, …) opened by the sheet when the
 * user commits and closed when that batch settles. It encodes nothing about
 * the user.
 *
 * The three poses of one batch run CONCURRENTLY (see `AddPhotoSheet.handleSave`),
 * so their lines interleave under a single shared `attempt`. That is the point:
 * `attempt` groups the batch, and the `pose` field on each line separates the
 * three timelines within it. Read a batch by filtering on `pose`, never by
 * assuming adjacent lines belong to the same photo. This is a diagnostic aid,
 * not a concurrency mechanism, and a batch that throws unexpectedly may leave
 * the id set until the next save opens a new one.
 */

/** Where a real lock call came from. Distinguishes the causes under suspicion. */
export type PhotoVaultLockOrigin =
  | 'app-state'
  | 'screen-unmount'
  | 'identity-change'
  | 'unspecified';

const SCOPE = 'photoVault:trace';

function isEnabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

const processStartedAt = now();

let sequence = 0;
let saveSequence = 0;
let currentAttempt: string | null = null;
let uploadsInFlight = 0;

/** Opens a new save batch and returns its id. */
export function beginPhotoVaultSaveAttempt(): string {
  saveSequence += 1;
  currentAttempt = `save-${saveSequence}`;
  return currentAttempt;
}

export function endPhotoVaultSaveAttempt(): void {
  currentAttempt = null;
}

/** Null when no save batch is open. Read by the AppState trace. */
export function currentPhotoVaultSaveAttempt(): string | null {
  return currentAttempt;
}

export function notePhotoVaultUploadStarted(): void {
  if (!isEnabled()) return;
  uploadsInFlight += 1;
}

export function notePhotoVaultUploadSettled(): void {
  if (!isEnabled()) return;
  uploadsInFlight = Math.max(0, uploadsInFlight - 1);
}

/** How many uploads are between their first and last line. Always 0 in release. */
export function photoVaultUploadsInFlight(): number {
  return uploadsInFlight;
}

/**
 * Emits one timeline line.
 *
 * `seq` orders lines that share a millisecond, `tMs` is relative to process
 * start (no wall clock, no timezone), and `attempt` ties async work back to
 * the save that started it.
 */
export function tracePhotoVault(event: string, fields?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  sequence += 1;
  logDebug(SCOPE, event, {
    seq: sequence,
    tMs: Math.round(now() - processStartedAt),
    attempt: currentAttempt ?? 'none',
    ...fields,
  });
}

/**
 * Emits a start line and returns the function that emits its end line with the
 * elapsed duration. The returned function also returns that duration, so a
 * caller can record it without measuring twice.
 */
export function startPhotoVaultTrace(
  event: string,
  fields?: Record<string, unknown>,
): (endEvent: string, endFields?: Record<string, unknown>) => number {
  const startedAt = now();
  tracePhotoVault(event, fields);
  return (endEvent, endFields) => {
    const ms = Math.max(0, Math.round(now() - startedAt));
    tracePhotoVault(endEvent, { ...endFields, ms });
    return ms;
  };
}
