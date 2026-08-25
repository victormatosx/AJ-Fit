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
  operation: 'start' | 'update' | 'end',
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
    logInfo('restLiveActivity', 'module_available', { available: false });
    logInfo('restLiveActivity', 'rest_live_unsupported', { reason: 'module-unavailable' });
    return null;
  }

  logInfo('restLiveActivity', 'module_available', { available: true });
  const capabilities = normalizeCapabilities(await nativeModule.getCapabilities());
  logInfo('restLiveActivity', 'capabilities', capabilities);
  if (!capabilities.available) {
    logInfo('restLiveActivity', 'rest_live_unsupported', { reason: 'surface-unavailable' });
    return null;
  }
  return nativeModule;
}

async function getCapabilities(): Promise<RestLiveCapabilities> {
  const nativeModule = getAJFitRestActivityNativeModule();
  if (!nativeModule) {
    logInfo('restLiveActivity', 'module_available', { available: false });
    logInfo('restLiveActivity', 'rest_live_unsupported', { reason: 'module-unavailable' });
    return NO_REST_LIVE_CAPABILITIES;
  }

  logInfo('restLiveActivity', 'module_available', { available: true });
  try {
    const capabilities = normalizeCapabilities(await nativeModule.getCapabilities());
    logInfo('restLiveActivity', 'capabilities', capabilities);
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
  logInfo('restLiveActivity', 'rest_live_start_requested', {
    startedAt: state.startedAt,
    endsAt: state.endsAt,
    setIndex: state.setIndex,
    totalSets: state.totalSets,
  });
  if (!isValidState(state)) {
    logWarn('restLiveActivity', 'rest_live_invalid_state', { operation: 'start' });
    return Promise.resolve();
  }

  return enqueueNativeOperation('start', async () => {
    const nativeModule = await getSupportedNativeModule();
    if (!nativeModule) return;

    if (logicalSessionId === state.sessionId) {
      await nativeModule.update(state);
      return;
    }

    await nativeModule.start(state);
    logicalSessionId = state.sessionId;
  });
}

function update(state: RestActivityState): Promise<void> {
  logInfo('restLiveActivity', 'rest_live_update_requested');
  if (!isValidState(state)) {
    logWarn('restLiveActivity', 'rest_live_invalid_state', { operation: 'update' });
    return Promise.resolve();
  }

  return enqueueNativeOperation('update', async () => {
    const nativeModule = await getSupportedNativeModule();
    if (!nativeModule || logicalSessionId !== state.sessionId) return;
    await nativeModule.update(state);
  });
}

function end(reason: RestActivityEndReason): Promise<void> {
  logInfo('restLiveActivity', 'rest_live_end_requested', { reason });
  return enqueueNativeOperation('end', async () => {
    const sessionId = logicalSessionId;
    try {
      const nativeModule = await getSupportedNativeModule();
      if (!nativeModule || !sessionId) return;
      await nativeModule.end(sessionId, reason);
    } finally {
      // Completed/cancelled close only the current rest presentation. Keeping
      // the logical session lets the next rest update the same native surface.
      if (reason === 'workout_ended') logicalSessionId = null;
    }
  });
}

export const restLiveActivity = Object.freeze({
  getCapabilities,
  start,
  update,
  end,
});
