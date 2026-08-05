/**
 * Central contract for the app's supported UI languages.
 *
 * Persisted at `users/{uid}.preferences.language`. New users are created with
 * DEFAULT_LANGUAGE remains the provisioning default for new remote profiles;
 * initial UI selection is resolved separately from storage and system locale.
 *
 * `firestore.rules :: preferencesValid` MUST accept exactly this set. If you
 * add or remove an entry, update the rules file (and its tests) in the same
 * change — the contract lives in both places by design (server-side
 * validation cannot import TS).
 */
export const SUPPORTED_LANGUAGES = ['pt-BR', 'en', 'es'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'pt-BR';

/** Type guard for arbitrary input (rules tests, sync code, migrations). */
export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}
