import i18n from './index';
import { writeStoredLanguage } from './languageStorage';
import { normalizeLanguage } from './normalizeLanguage';
import { isSupportedLanguage, type SupportedLanguage } from '../types/language';
import { logError } from '../lib/logger';

/**
 * Applies a language change locally: swaps i18next, persists to AsyncStorage,
 * and rolls back the runtime language if persistence fails so the UI never
 * ends up out of sync with what the next cold start will read.
 *
 * Deliberately does NOT:
 *   • touch Firestore (authenticated remote sync belongs to syncLanguage);
 *   • take a UID or depend on auth state — pre-auth users must be able to
 *     change the language on the login funnel;
 *   • set `pendingLanguageSync` — local-only callers have no authenticated UID.
 *
 * Contract:
 *   • no-op when the requested language equals the current one;
 *   • throws when handed a value outside the language contract, before
 *     touching either i18next or storage;
 *   • throws when i18next itself refuses the change — nothing is persisted;
 *   • throws when storage refuses the write — i18next is rolled back to the
 *     previous language first, so the runtime matches disk again.
 */
export async function changeLocalLanguage(
  next: SupportedLanguage,
): Promise<void> {
  if (!isSupportedLanguage(next)) {
    throw new Error(
      `[changeLocalLanguage] refuse: ${String(next)} is not a supported language`,
    );
  }

  // `i18n.language` after init is a SupportedLanguage, but defensively
  // normalize because Fast Refresh / test resets can leave it undefined.
  const previous = normalizeLanguage(i18n.language);
  if (previous === next) return;

  await i18n.changeLanguage(next);
  try {
    await writeStoredLanguage(next);
  } catch (storageErr) {
    // Persist failed after the runtime switch — restore the runtime so the
    // next cold start (which will read from AsyncStorage) matches what the
    // user sees now. If the rollback itself throws, we surface the ORIGINAL
    // storage error via `cause` since that's the actionable failure.
    try {
      await i18n.changeLanguage(previous);
    } catch (rollbackErr) {
      logError('changeLocalLanguage:rollback', rollbackErr);
    }
    throw storageErr;
  }
}
