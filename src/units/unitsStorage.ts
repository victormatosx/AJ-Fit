import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isUnitsPreference,
  type UnitsPreference,
} from '../types/units';

export const UNITS_PREFERENCE_STORAGE_KEY = 'ajfit-units-preference';

/** Reads the local units preference, treating missing or invalid data as unset. */
export async function readStoredUnitsPreference(): Promise<UnitsPreference | null> {
  let raw: string | null;

  try {
    raw = await AsyncStorage.getItem(UNITS_PREFERENCE_STORAGE_KEY);
  } catch (err) {
    console.error('[unitsStorage] read failed, treating as unset', err);
    return null;
  }

  return isUnitsPreference(raw) ? raw : null;
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
}
