import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isUnitsPreference,
  type UnitsPreference,
} from '../types/units';
import { logError } from '../lib/logger';

export const UNITS_PREFERENCE_STORAGE_KEY = 'ajfit-units-preference';

type UnitsPreferenceListener = (preference: UnitsPreference) => void;
const listeners = new Set<UnitsPreferenceListener>();

function publish(preference: UnitsPreference): void {
  listeners.forEach((listener) => listener(preference));
}

export function subscribeStoredUnitsPreference(
  listener: UnitsPreferenceListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads the local units preference, treating missing or invalid data as unset. */
export async function readStoredUnitsPreference(): Promise<UnitsPreference | null> {
  let raw: string | null;

  try {
    raw = await AsyncStorage.getItem(UNITS_PREFERENCE_STORAGE_KEY);
  } catch (err) {
    logError('unitsStorage:read', err);
    return null;
  }

  if (!isUnitsPreference(raw)) return null;
  publish(raw);
  return raw;
}

/** Persists only values from the units preference contract. */
export async function writeStoredUnitsPreference(
  preference: UnitsPreference,
): Promise<void> {
  if (!isUnitsPreference(preference)) {
    throw new Error(
      `[unitsStorage] refuse to persist invalid preference: ${String(preference)}`,
    );
  }

  await AsyncStorage.setItem(UNITS_PREFERENCE_STORAGE_KEY, preference);
  publish(preference);
}
