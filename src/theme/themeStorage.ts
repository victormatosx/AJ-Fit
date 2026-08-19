import AsyncStorage from '@react-native-async-storage/async-storage';

import { logError } from '../lib/logger';
import {
  DEFAULT_THEME,
  isThemeMode,
  resolveThemeMode,
  type ThemeMode,
} from './theme';

/** Local, device-wide preference. It is intentionally independent from UID/Auth. */
export const THEME_PREFERENCE_STORAGE_KEY = 'ajfit-theme-preference';

/**
 * Reads exactly one literal ThemeMode. Missing, corrupted, legacy `system`
 * and storage failures all resolve to the official Dark product default.
 */
export async function readStoredThemePreference(): Promise<ThemeMode> {
  try {
    const raw = await AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    return resolveThemeMode(raw);
  } catch (err) {
    logError('themeStorage:read', err);
    return DEFAULT_THEME;
  }
}

/** Persists only the two values in the local runtime contract. */
export async function writeStoredThemePreference(mode: ThemeMode): Promise<void> {
  if (!isThemeMode(mode)) {
    throw new Error(
      `[themeStorage] refuse to persist invalid preference: ${String(mode)}`,
    );
  }

  await AsyncStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, mode);
}
