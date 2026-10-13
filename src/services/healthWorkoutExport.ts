import type { PersistedWorkoutExecution } from './workoutExecutions';

import { getHealthPlatform } from './healthIntegration';
import { getLastKnownHealthIntegrationIntent, readHealthIntegrationIntent } from './healthIntegrationPreferences';
import { writeHealthWorkout, HealthWorkoutNativeError } from './healthWorkoutNative';
import {
  enqueueHealthWorkoutExport,
  healthWorkoutExportLastSuccess,
  healthWorkoutExportPendingCount,
  markHealthWorkoutExportFailed,
  markHealthWorkoutExportSucceeded,
  markHealthWorkoutExportWriting,
  readHealthWorkoutExportState,
  setHealthWorkoutExportIntentState,
} from './healthWorkoutExportStore';
import {
  listWorkoutExecutionsFinishedSince,
  loadWorkoutExecution,
} from './workoutExecutions';
import { hasScheduledSessionCompletion } from './workoutSchedule';
import type {
  HealthWorkoutExportPlatform,
  HealthWorkoutExportRecord,
  HealthWorkoutExportRunResult,
  HealthWorkoutExportState,
  HealthWorkoutExportUiStatus,
} from '../types/healthWorkoutExport';

const MAX_EXPORTS_PER_RUN = 25;
const MIN_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1_000;

const inFlight = new Map<string, Promise<HealthWorkoutExportRunResult>>();

export class HealthWorkoutExportCancellation extends Error {
  constructor() {
    super('HEALTH_WORKOUT_EXPORT_CANCELLED');
    this.name = 'HealthWorkoutExportCancellation';
  }
}

export function isHealthWorkoutExportCancellation(cause: unknown): boolean {
  return cause instanceof HealthWorkoutExportCancellation;
}

function assertContinuing(shouldContinue?: () => boolean): void {
  if (shouldContinue && !shouldContinue()) throw new HealthWorkoutExportCancellation();
}

function timestampDate(value: PersistedWorkoutExecution['startedAt'] | null): Date | null {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value.toMillis());
  return Number.isNaN(date.getTime()) ? null : date;
}

export function healthWorkoutPayloadFromExecution(execution: PersistedWorkoutExecution) {
  const startDate = timestampDate(execution.startedAt);
  const endDate = timestampDate(execution.finishedAt);
  if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()
    || typeof execution.sessionName !== 'string' || execution.sessionName.trim().length === 0) return null;
  return {
    executionId: execution.executionId,
    sessionName: execution.sessionName.trim(),
    startDate,
    endDate,
  };
}

export function isTerminalHealthWorkoutExecution(execution: PersistedWorkoutExecution): boolean {
  return (execution.status === 'COMPLETED' || execution.status === 'PARTIALLY_COMPLETED')
    && execution.completion !== undefined
    && healthWorkoutPayloadFromExecution(execution) !== null;
}

async function hasAuthority(uid: string, execution: PersistedWorkoutExecution): Promise<boolean> {
  if (!isTerminalHealthWorkoutExecution(execution)) return false;
  return hasScheduledSessionCompletion({
    uid,
    programId: execution.programId,
    ...(execution.programInstanceId ? { programInstanceId: execution.programInstanceId } : {}),
    sessionIndex: execution.sessionIndex,
    scheduledLocalDate: execution.scheduledLocalDate,
    ...(execution.occurrence ? { occurrence: execution.occurrence } : {}),
  });
}

function eligibleAfterCutoff(execution: PersistedWorkoutExecution, enabledAtIso: string | null): boolean {
  const finishedAt = timestampDate(execution.finishedAt);
  if (!finishedAt || !enabledAtIso) return false;
  return finishedAt.getTime() >= new Date(enabledAtIso).getTime();
}

async function enqueueIfAuthoritative(
  uid: string,
  platform: HealthWorkoutExportPlatform,
  state: HealthWorkoutExportState,
  execution: PersistedWorkoutExecution,
  shouldContinue?: () => boolean,
): Promise<boolean> {
  if (state.records[execution.executionId] || !eligibleAfterCutoff(execution, state.enabledAtIso)) return false;
  assertContinuing(shouldContinue);
  if (!(await hasAuthority(uid, execution))) return false;
  assertContinuing(shouldContinue);
  const finishedAt = timestampDate(execution.finishedAt);
  if (!finishedAt) return false;
  await enqueueHealthWorkoutExport(uid, platform, execution.executionId, finishedAt);
  return true;
}

/**
 * Queues only an execution backed by both terminal Firestore state and the
 * deterministic COMPLETED schedule event written by the backend transaction.
 */
export async function queueConfirmedHealthWorkoutExecution(
  uid: string,
  executionId: string,
  shouldContinue?: () => boolean,
): Promise<boolean> {
  const platform = getHealthPlatform();
  if (platform === 'unsupported') return false;
  assertContinuing(shouldContinue);
  const intent = await readHealthIntegrationIntent(uid);
  if (intent !== 'enabled') return false;
  const state = await setHealthWorkoutExportIntentState(uid, platform, intent);
  assertContinuing(shouldContinue);
  const execution = await loadWorkoutExecution(uid, executionId);
  if (!execution) return false;
  return enqueueIfAuthoritative(uid, platform, state, execution, shouldContinue);
}

async function reconcileQueue(
  uid: string,
  platform: HealthWorkoutExportPlatform,
  state: HealthWorkoutExportState,
  shouldContinue?: () => boolean,
): Promise<HealthWorkoutExportState> {
  if (!state.enabledAtIso) return state;
  assertContinuing(shouldContinue);
  const candidates = await listWorkoutExecutionsFinishedSince(uid, new Date(state.enabledAtIso));
  let current = state;
  for (const execution of candidates) {
    assertContinuing(shouldContinue);
    if (await enqueueIfAuthoritative(uid, platform, current, execution, shouldContinue)) {
      current = await readHealthWorkoutExportState(uid, platform);
    }
  }
  return current;
}

function due(record: HealthWorkoutExportRecord, now: Date, force: boolean): boolean {
  if (!['pending', 'retryable_error', 'permission_required', 'unavailable'].includes(record.status)) return false;
  if (force || !record.nextAttemptAtIso) return true;
  return new Date(record.nextAttemptAtIso).getTime() <= now.getTime();
}

function retryAt(attemptCount: number, now: Date): Date {
  const delay = Math.min(MAX_RETRY_DELAY_MS, MIN_RETRY_DELAY_MS * 2 ** Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + delay);
}

function resultFromState(
  state: HealthWorkoutExportState,
  status: Exclude<HealthWorkoutExportUiStatus, 'idle' | 'exporting'>,
  exported: number,
): HealthWorkoutExportRunResult {
  return {
    status,
    exported,
    pending: healthWorkoutExportPendingCount(state),
    lastSuccessfulAt: healthWorkoutExportLastSuccess(state),
  };
}

async function runExport(
  uid: string,
  platform: HealthWorkoutExportPlatform,
  options: { force: boolean; reconcile: boolean; shouldContinue?: () => boolean },
): Promise<HealthWorkoutExportRunResult> {
  assertContinuing(options.shouldContinue);
  const intent = await readHealthIntegrationIntent(uid);
  let state = await setHealthWorkoutExportIntentState(uid, platform, intent);
  if (intent !== 'enabled') return resultFromState(state, 'no_data', 0);
  if (options.reconcile) state = await reconcileQueue(uid, platform, state, options.shouldContinue);

  const now = new Date();
  const records = Object.values(state.records)
    .filter((record) => due(record, now, options.force))
    .sort((left, right) => left.finishedAtIso.localeCompare(right.finishedAtIso))
    .slice(0, MAX_EXPORTS_PER_RUN);
  let exported = 0;
  let terminalStatus: Exclude<HealthWorkoutExportUiStatus, 'idle' | 'exporting'> = records.length ? 'success' : 'no_data';

  for (const record of records) {
    assertContinuing(options.shouldContinue);
    const execution = await loadWorkoutExecution(uid, record.executionId);
    if (!execution || !(await hasAuthority(uid, execution))) {
      state = await markHealthWorkoutExportFailed(uid, platform, record.executionId, {
        status: 'blocked_invalid', errorCode: 'invalid_execution', nextAttemptAt: null,
      });
      terminalStatus = 'error';
      continue;
    }
    const payload = healthWorkoutPayloadFromExecution(execution);
    if (!payload) {
      state = await markHealthWorkoutExportFailed(uid, platform, record.executionId, {
        status: 'blocked_invalid', errorCode: 'invalid_execution', nextAttemptAt: null,
      });
      terminalStatus = 'error';
      continue;
    }

    assertContinuing(options.shouldContinue);
    // Disabling mid-run must block every NEW native write immediately, even
    // if the caller's `shouldContinue` wasn't wired to the intent (e.g. a
    // caller other than the hook). `lastKnownByUid` is updated synchronously
    // by `setHealthIntegrationIntent` the instant the user disconnects, so
    // this is at least as current as the `intent` snapshot taken at the top
    // of this run — unlike that one-time snapshot, it is re-read before every
    // record. A write already in flight (the `try` block below) is never
    // aborted: the native SDKs expose no cancellation, and its outcome must
    // still be persisted either way (see the comment on markSucceeded below).
    const liveIntent = getLastKnownHealthIntegrationIntent(uid) ?? await readHealthIntegrationIntent(uid);
    if (liveIntent !== 'enabled') {
      if (exported === 0) terminalStatus = 'no_data';
      break;
    }
    state = await markHealthWorkoutExportWriting(uid, platform, record.executionId);
    try {
      const native = await writeHealthWorkout(uid, payload);
      // Persist the result even when logout/disconnect happened while the OS
      // write was in flight. Dropping this fact would reopen the duplicate
      // window on the next launch; no subsequent record is dispatched.
      state = await markHealthWorkoutExportSucceeded(uid, platform, record.executionId, native.nativeRecordId);
      exported += 1;
      terminalStatus = 'success';
      if (options.shouldContinue && !options.shouldContinue()) break;
    } catch (cause) {
      const latest = state.records[record.executionId];
      const attemptCount = latest?.attemptCount ?? record.attemptCount + 1;
      if (cause instanceof HealthWorkoutNativeError && cause.code === 'permission_required') {
        state = await markHealthWorkoutExportFailed(uid, platform, record.executionId, {
          status: 'permission_required', errorCode: cause.code, nextAttemptAt: retryAt(attemptCount, new Date()),
        });
        terminalStatus = 'permission_required';
      } else if (cause instanceof HealthWorkoutNativeError && cause.code === 'unavailable') {
        state = await markHealthWorkoutExportFailed(uid, platform, record.executionId, {
          status: 'unavailable', errorCode: cause.code, nextAttemptAt: retryAt(attemptCount, new Date()),
        });
        terminalStatus = 'unavailable';
      } else {
        state = await markHealthWorkoutExportFailed(uid, platform, record.executionId, {
          status: 'retryable_error', errorCode: 'native_error', nextAttemptAt: retryAt(attemptCount, new Date()),
        });
        terminalStatus = 'error';
      }
      // One provider-level failure normally applies to every pending record;
      // stop here instead of opening several permission prompts/error calls.
      break;
    }
  }

  return resultFromState(state, terminalStatus, exported);
}

/** Per-UID/per-platform single flight shared by the hook and finish callback. */
export function processHealthWorkoutExports(
  uid: string,
  options: { force?: boolean; reconcile?: boolean; shouldContinue?: () => boolean } = {},
): Promise<HealthWorkoutExportRunResult> {
  const platform = getHealthPlatform();
  if (platform === 'unsupported') {
    return Promise.resolve({ status: 'unavailable', exported: 0, pending: 0, lastSuccessfulAt: null });
  }
  const key = `${uid}:${platform}`;
  const current = inFlight.get(key);
  if (current) return current;
  const task = runExport(uid, platform, {
    force: options.force ?? false,
    reconcile: options.reconcile ?? true,
    shouldContinue: options.shouldContinue,
  }).finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

/**
 * Fast path used after finalization. Queueing happens before joining the
 * process-wide single flight, so a worker that had already taken its
 * pending snapshot just beforehand still picks up this record.
 */
export async function exportConfirmedHealthWorkoutExecution(
  uid: string,
  executionId: string,
  options: { shouldContinue?: () => boolean } = {},
): Promise<HealthWorkoutExportRunResult | null> {
  await queueConfirmedHealthWorkoutExecution(uid, executionId, options.shouldContinue);
  return processHealthWorkoutExports(uid, {
    reconcile: false,
    shouldContinue: options.shouldContinue,
  });
}
