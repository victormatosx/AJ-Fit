import { getAJFitRestActivityNativeModule } from '../../modules/ajfit-rest-activity';
import { logInfo, logWarn } from './logger';
import type {
  RestActivityEndReason,
  RestActivityState,
  RestLiveCapabilities,
  RestLiveSurface,
} from '../types/restLiveActivity';

export type {
  RestActivityEndReason,
  RestActivityState,
  RestLiveCapabilities,
  RestLiveSurface,
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

function isValidState(state: RestActivityState): boolean {
  return (
    !!state &&
    typeof state.sessionId === 'string' &&
    state.sessionId.trim().length > 0 &&
    Number.isInteger(state.startedAt) &&
    state.startedAt >= 0 &&
    Number.isInteger(state.endsAt) &&
    state.endsAt > state.startedAt &&
    typeof state.exerciseName === 'string' &&
    state.exerciseName.trim().length > 0 &&
    Number.isInteger(state.setIndex) &&
    state.setIndex >= 1 &&
    Number.isInteger(state.totalSets) &&
    state.totalSets >= state.setIndex
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

async function getSupportedNativeModule() {
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
  return nativeModule;
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

function start(state: RestActivityState): Promise<void> {
  if (!isValidState(state)) {
    logWarn('restLiveActivity', 'rest_live_native_error', {
      operation: 'start',
      reason: 'invalid-state',
    });
    return Promise.resolve();
  }

  return enqueueNativeOperation('start', async () => {
    const nativeModule = await getSupportedNativeModule();
    if (!nativeModule) return;

    if (logicalSessionId === state.sessionId) {
      await nativeModule.update(state);
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

function update(state: RestActivityState): Promise<void> {
  if (!isValidState(state)) {
    logWarn('restLiveActivity', 'rest_live_native_error', {
      operation: 'update',
      reason: 'invalid-state',
    });
    return Promise.resolve();
  }

  return enqueueNativeOperation('update', async () => {
    const nativeModule = await getSupportedNativeModule();
    if (!nativeModule || logicalSessionId !== state.sessionId) return;
    await nativeModule.update(state);
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
