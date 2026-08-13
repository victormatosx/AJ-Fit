import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupportedLanguage, type SupportedLanguage } from '../types/language';

/**
 * Local-only cache for the user's UI language.
 *
 * This deliberately lives outside `secureAuthStorage` (the AES-GCM sealed
 * bucket used for the Firebase Auth session): the language choice is not
 * confidential, and encrypting it would force i18n bootstrap to wait for the
 * Keychain/Keystore + secure-store key derivation on every cold start — the
 * cost buys nothing here.
 *
 * Contract:
 *   • storage is asynchronous — every caller must await;
 *   • unknown/corrupted values are ignored (returned as null), never surfaced;
 *   • read failures are treated as "unset" so bootstrap can still proceed;
 *   • writes are validated against the language contract before touching disk;
 *   • logout DOES NOT clear this key (see docs — the outgoing user's chosen
 *     UI language stays as the pre-auth default; the next remote sync will
 *     overwrite it for the incoming user).
 */
export const LANGUAGE_STORAGE_KEY = 'ajfit-language';

export async function readStoredLanguage(): Promise<SupportedLanguage | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch (err) {
    // Never fail bootstrap because the OS storage layer hiccuped — the app
    // must still start. Downstream detection will fall back to the system
    // locale, then to English.
    console.error('[languageStorage] read failed, treating as unset', err);
    return null;
  }
  if (raw !== null && isSupportedLanguage(raw)) return raw;
  return null;
}

export async function writeStoredLanguage(
  language: SupportedLanguage,
): Promise<void> {
  if (!isSupportedLanguage(language)) {
    // Belt-and-suspenders — the type keeps this out of well-typed callers,
    // this guard covers dynamic paths (e.g. future remote sync) that hand us
    // a Firestore value cast as string.
    throw new Error(
      `[languageStorage] refuse to persist non-supported language: ${String(language)}`,
    );
  }
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}
