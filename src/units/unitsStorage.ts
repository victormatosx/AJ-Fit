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

/**
 * Fase 11 audit finding: unlike `language` (`i18n/languageStorage.ts`,
 * deliberately NOT cleared on logout — documented carry-over default), this
 * key has no such documented exception, and it IS account data —
 * `units/syncUnits.ts`'s `pushRemoteUnits` writes it to
 * `users/{uid}.preferences.units`. `reconcileUnitsOnLoad` already refuses to
 * apply a pending value stamped with a different uid on the NEXT login, so
 * this is not a full cross-account leak, but that self-heal only runs once
 * reconciliation executes — clearing proactively on account deletion removes
 * that race window entirely, the same defensive treatment already given to
 * the onboarding draft and workout-substitution preferences.
 */
export async function clearStoredUnitsPreference(): Promise<void> {
  try {
    await AsyncStorage.removeItem(UNITS_PREFERENCE_STORAGE_KEY);
  } catch (err) {
    logError('unitsStorage:clear', err);
  }
}
