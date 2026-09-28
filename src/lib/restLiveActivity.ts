import { getAJFitRestActivityNativeModule } from '../../modules/ajfit-rest-activity';
import { logInfo, logWarn } from './logger';
import type {
  RestActivityEndReason,
  RestActivityUpdateOptions,
  RestLiveCapabilities,
  RestLiveSurface,
  WorkoutActivityState,
} from '../types/restLiveActivity';
import {
  REST_ACTIVITY_NEXT_ACTION,
  REST_ACTIVITY_PHASE,
} from '../types/restLiveActivity';

export type {
  RestActivityEndReason,
  RestActivityState,
  RestActivityUpdateOptions,
  RestLiveCapabilities,
  RestLiveSurface,
  WorkoutActivityState,
} from '../types/restLiveActivity';

const NO_REST_LIVE_CAPABILITIES: RestLiveCapabilities = {
  available: false,
  surface: 'none',
};

const SUPPORTED_SURFACES = new Set<RestLiveSurface>([
  'ios-live-activity',
  'android-live-update',
  'android-notification',
  'none',
]);

let operationQueue: Promise<void> = Promise.resolve();
let logicalSessionId: string | null = null;
// True on a fresh JS process because an older native process/system surface
// may have survived. A successful start makes cleanup relevant again.
let nativeCleanupRequired = true;

function normalizeCapabilities(value: unknown): RestLiveCapabilities {
  if (!value || typeof value !== 'object') return NO_REST_LIVE_CAPABILITIES;
  const candidate = value as { available?: unknown; surface?: unknown };
  if (
    candidate.available !== true ||
    typeof candidate.surface !== 'string' ||
    !SUPPORTED_SURFACES.has(candidate.surface as RestLiveSurface) ||
    candidate.surface === 'none'
  ) return NO_REST_LIVE_CAPABILITIES;
  return { available: true, surface: candidate.surface as RestLiveSurface };
}

function isValidState(state: WorkoutActivityState): boolean {
  const hasValidBase =
    !!state &&
    typeof state.sessionId === 'string' &&
    state.sessionId.trim().length > 0 &&
    Number.isInteger(state.startedAt) &&
    state.startedAt >= 0 &&
    typeof state.exerciseName === 'string' &&
    state.exerciseName.trim().length > 0 &&
    Number.isInteger(state.setIndex) &&
    Number.isInteger(state.totalSets) &&
    state.totalSets >= 1 &&
    Object.values(REST_ACTIVITY_PHASE).includes(state.phase);
  if (!hasValidBase) return false;

  if (state.phase === REST_ACTIVITY_PHASE.WORKOUT_ACTIVE) {
    return state.endsAt === undefined &&
      state.setIndex >= 0 &&
      state.setIndex < state.totalSets &&
      state.nextAction === REST_ACTIVITY_NEXT_ACTION.NEXT_SET &&
      state.nextSetIndex === state.setIndex + 1 &&
      state.nextExerciseName === undefined;
  }

  if (
    !Number.isInteger(state.endsAt) ||
    state.endsAt <= state.startedAt ||
    state.setIndex < 1 ||
    state.totalSets < state.setIndex
  ) return false;

  if (
    state.phase === REST_ACTIVITY_PHASE.CARDIO_RUNNING ||
    state.phase === REST_ACTIVITY_PHASE.CARDIO_PAUSED ||
    state.phase === REST_ACTIVITY_PHASE.CARDIO_COMPLETED
  ) {
    return state.nextAction === REST_ACTIVITY_NEXT_ACTION.FINISH_WORKOUT &&
      state.nextSetIndex === undefined &&
      state.nextExerciseName === undefined;
  }

  const hasValidNextAction =
    state.nextAction === REST_ACTIVITY_NEXT_ACTION.NEXT_SET
      ? Number.isInteger(state.nextSetIndex) &&
        state.nextSetIndex > state.setIndex &&
        state.nextSetIndex <= state.totalSets &&
        state.nextExerciseName === undefined
      : state.nextAction === REST_ACTIVITY_NEXT_ACTION.NEXT_EXERCISE &&
        state.nextSetIndex === undefined &&
        state.setIndex === state.totalSets &&
        typeof state.nextExerciseName === 'string' &&
        state.nextExerciseName.trim().length > 0;

  return (
    (state.phase === REST_ACTIVITY_PHASE.RESTING || state.phase === state.nextAction) &&
    hasValidNextAction
  );
}

function enqueueNativeOperation(
  operation: 'start' | 'update' | 'end' | 'cleanup',
  callback: () => Promise<void>,
): Promise<void> {
  const next = operationQueue.then(async () => {
    try {
      await callback();
    } catch (error) {
      logWarn('restLiveActivity', 'rest_live_native_error', { operation, error });
    }
  });
  operationQueue = next;
  return next;
}

async function getSupportedNativeModule(requiredSurface?: RestLiveSurface) {
  const nativeModule = getAJFitRestActivityNativeModule();
  if (!nativeModule) {
    logInfo('restLiveActivity', 'rest_live_unsupported', { reason: 'module-unavailable' });
    return null;
  }

  const capabilities = normalizeCapabilities(await nativeModule.getCapabilities());
  if (!capabilities.available) {
    logInfo('restLiveActivity', 'rest_live_unsupported', { reason: 'surface-unavailable' });
    return null;
  }
  if (requiredSurface && capabilities.surface !== requiredSurface) {
    logInfo('restLiveActivity', 'rest_live_unsupported', {
      reason: 'surface-mismatch',
      requiredSurface,
    });
    return null;
  }
  return nativeModule;
}

function isCardioState(state: WorkoutActivityState): boolean {
  return state.nextAction === REST_ACTIVITY_NEXT_ACTION.FINISH_WORKOUT;
}

function isIOSOnlyState(state: WorkoutActivityState): boolean {
  return isCardioState(state) || state.phase === REST_ACTIVITY_PHASE.WORKOUT_ACTIVE;
}

async function getCapabilities(): Promise<RestLiveCapabilities> {
  const nativeModule = getAJFitRestActivityNativeModule();
  if (!nativeModule) {
    logInfo('restLiveActivity', 'rest_live_unsupported', { reason: 'module-unavailable' });
    return NO_REST_LIVE_CAPABILITIES;
  }

  try {
    const capabilities = normalizeCapabilities(await nativeModule.getCapabilities());
    if (!capabilities.available) {
      logInfo('restLiveActivity', 'rest_live_unsupported', { reason: 'surface-unavailable' });
    }
    return capabilities;
  } catch (error) {
    logWarn('restLiveActivity', 'rest_live_native_error', {
      operation: 'capabilities',
      error,
    });
    return NO_REST_LIVE_CAPABILITIES;
  }
}

function start(state: WorkoutActivityState): Promise<void> {
  if (!isValidState(state)) {
    logWarn('restLiveActivity', 'rest_live_native_error', {
      operation: 'start',
      reason: 'invalid-state',
    });
    return Promise.resolve();
  }

  return enqueueNativeOperation('start', async () => {
    const nativeModule = await getSupportedNativeModule(
      isIOSOnlyState(state) ? 'ios-live-activity' : undefined,
    );
    if (!nativeModule) return;

    if (logicalSessionId === state.sessionId) {
      await nativeModule.update(state, false);
      nativeCleanupRequired = true;
      logInfo('restLiveActivity', 'rest_live_started', { reused: true });
      return;
    }

    await nativeModule.start(state);
    logicalSessionId = state.sessionId;
    nativeCleanupRequired = true;
    logInfo('restLiveActivity', 'rest_live_started', { reused: false });
  });
}

function update(
  state: WorkoutActivityState,
  options: RestActivityUpdateOptions = {},
): Promise<void> {
  if (!isValidState(state)) {
    logWarn('restLiveActivity', 'rest_live_native_error', {
      operation: 'update',
      reason: 'invalid-state',
    });
    return Promise.resolve();
  }

  return enqueueNativeOperation('update', async () => {
    const nativeModule = await getSupportedNativeModule(
      isIOSOnlyState(state) ? 'ios-live-activity' : undefined,
    );
    if (!nativeModule || logicalSessionId !== state.sessionId) return;
    await nativeModule.update(state, options.alert === true);
    nativeCleanupRequired = true;
    logInfo('restLiveActivity', 'rest_live_updated');
  });
}

function end(reason: RestActivityEndReason): Promise<void> {
  return enqueueNativeOperation('end', async () => {
    const sessionId = logicalSessionId;
    let ended = false;
    try {
      if (!sessionId) return;
      // Dismissal must not depend on the capability that allowed publication.
      // Permissions/Live Activities may be disabled while a surface from the
      // same workout is still visible.
      const nativeModule = getAJFitRestActivityNativeModule();
      if (!nativeModule) {
        logInfo('restLiveActivity', 'rest_live_unsupported', {
          reason: 'module-unavailable',
        });
        return;
      }
      await nativeModule.end(sessionId, reason);
      ended = true;
      logInfo('restLiveActivity', 'rest_live_ended', { reason });
    } finally {
      // Completed/cancelled close only the current rest presentation. Keeping
      // the logical session lets the next rest update the same native surface.
      if (reason === 'workout_ended') {
        logicalSessionId = null;
        if (ended) nativeCleanupRequired = false;
      }
    }
  });
}

/**
 * Removes presentation state whose owning workout cannot exist anymore.
 * Unlike start/update, cleanup intentionally bypasses capability checks:
 * revoking notification permission or disabling Live Activities must never
 * prevent an already-visible surface from being dismissed.
 */
function cleanup(): Promise<void> {
  return enqueueNativeOperation('cleanup', async () => {
    if (!nativeCleanupRequired && logicalSessionId === null) return;

    const nativeModule = getAJFitRestActivityNativeModule();
    if (!nativeModule || typeof nativeModule.cleanup !== 'function') {
      logicalSessionId = null;
      nativeCleanupRequired = false;
      logInfo('restLiveActivity', 'rest_live_unsupported', {
        reason: nativeModule ? 'cleanup-unavailable' : 'module-unavailable',
      });
      return;
    }

    try {
      await nativeModule.cleanup();
      nativeCleanupRequired = false;
      logInfo('restLiveActivity', 'rest_live_ended', { reason: 'cleanup' });
    } finally {
      logicalSessionId = null;
    }
  });
}

export const restLiveActivity = Object.freeze({
  getCapabilities,
  start,
  update,
  end,
  cleanup,
});
