import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseCardioSession, type CardioSession } from '../lib/cardioTimer';
import { logError, logWarn } from '../lib/logger';

export const CARDIO_SESSION_STORAGE_KEY = '@ajfit/cardio-session/v1';

// Same rationale as restSessionStorage: relevant transitions are serialized
// so a slow "started" write cannot overwrite a later "+5 min"/finish write
// that completed first.
let transitionQueue: Promise<void> = Promise.resolve();

function enqueueTransition(scope: string, operation: () => Promise<void>): Promise<void> {
  const next = transitionQueue.then(operation);
  transitionQueue = next.catch(() => undefined);
  return next.catch((error) => {
    logError(`cardioSessionStorage:${scope}`, error);
  });
}

export function persistCardioSession(session: CardioSession): Promise<void> {
  return enqueueTransition('write', () =>
    AsyncStorage.setItem(CARDIO_SESSION_STORAGE_KEY, JSON.stringify(session))
  );
}

export function clearCardioSession(): Promise<void> {
  return enqueueTransition('clear', () =>
    AsyncStorage.removeItem(CARDIO_SESSION_STORAGE_KEY)
  );
}

export async function readCardioSession(): Promise<CardioSession | null> {
  await transitionQueue;
  try {
    const raw = await AsyncStorage.getItem(CARDIO_SESSION_STORAGE_KEY);
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logWarn('cardioSessionStorage', 'persisted_cardio_malformed');
      await clearCardioSession();
      return null;
    }

    const session = parseCardioSession(parsed);
    if (session) return session;

    logWarn('cardioSessionStorage', 'persisted_cardio_invalid');
    await clearCardioSession();
    return null;
  } catch (error) {
    logError('cardioSessionStorage:read', error);
    return null;
  }
}
