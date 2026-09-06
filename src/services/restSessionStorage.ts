import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseActiveRest, type ActiveRest } from '../lib/restTimer';
import { logError, logWarn } from '../lib/logger';

export const REST_SESSION_STORAGE_KEY = '@ajfit/rest-session/v1';

// Relevant transitions are serialized so a slow "rest started" write cannot
// overwrite a later +15s or cleanup write that completed first.
let transitionQueue: Promise<void> = Promise.resolve();

function enqueueTransition(scope: string, operation: () => Promise<void>): Promise<void> {
  const next = transitionQueue.then(operation);
  transitionQueue = next.catch(() => undefined);
  return next.catch((error) => {
    logError(`restSessionStorage:${scope}`, error);
  });
}

export function persistRestSession(rest: ActiveRest): Promise<void> {
  return enqueueTransition('write', () =>
    AsyncStorage.setItem(REST_SESSION_STORAGE_KEY, JSON.stringify(rest))
  );
}

export function clearRestSession(): Promise<void> {
  return enqueueTransition('clear', () =>
    AsyncStorage.removeItem(REST_SESSION_STORAGE_KEY)
  );
}

export async function readRestSession(): Promise<ActiveRest | null> {
  await transitionQueue;
  try {
    const raw = await AsyncStorage.getItem(REST_SESSION_STORAGE_KEY);
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logWarn('restSessionStorage', 'persisted_rest_malformed');
      await clearRestSession();
      return null;
    }

    const rest = parseActiveRest(parsed);
    if (rest) return rest;

    logWarn('restSessionStorage', 'persisted_rest_invalid');
    await clearRestSession();
    return null;
  } catch (error) {
    logError('restSessionStorage:read', error);
    return null;
  }
}
