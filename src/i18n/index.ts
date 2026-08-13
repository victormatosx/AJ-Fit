import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import { readStoredLanguage } from './languageStorage';
import { normalizeLanguage } from './normalizeLanguage';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../types/language';
import { DEFAULT_NAMESPACE, NAMESPACES, resources } from './resourceCatalog';

export { DEFAULT_NAMESPACE, NAMESPACES, resources } from './resourceCatalog';

/**
 * i18n bootstrap for AJ Fit.
 *
 * Resolution order:
 *   1. AsyncStorage['ajfit-language'] (previous choice on this device)
 *   2. `Localization.getLocales()[0].languageTag` (OS language)
 *   3. 'en' (final fallback for anything the app doesn't support)
 *
 * `initI18n()` is idempotent: the module-level `initPromise` guarantees the
 * i18next instance is only wired up once per JS runtime, so Fast Refresh
 * cannot re-init (which would fire `initReactI18next` twice, duplicate
 * listeners, and generally scramble the store).
 *
 * The returned promise resolves with the language that was actually applied,
 * so callers (App.tsx gate + tests) can assert against it.
 */

let initPromise: Promise<SupportedLanguage> | null = null;

async function resolveInitialLanguage(): Promise<SupportedLanguage> {
  const stored = await readStoredLanguage();
  if (stored) return stored;
  // The OS may expose a list of preferred languages; index 0 is the top pick.
  const systemTag = Localization.getLocales()[0]?.languageTag ?? null;
  return normalizeLanguage(systemTag);
}

export function initI18n(): Promise<SupportedLanguage> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const initial = await resolveInitialLanguage();
    await i18n.use(initReactI18next).init({
      resources,
      lng: initial,
      fallbackLng: 'en',
      supportedLngs: [...SUPPORTED_LANGUAGES],
      defaultNS: DEFAULT_NAMESPACE,
      ns: [...NAMESPACES],
      interpolation: { escapeValue: false },
      returnNull: false,
      // No Suspense in the bootstrap path — App.tsx gates rendering with a
      // simple `i18nReady` boolean instead. Suspense would collide with the
      // `useFonts` gate that runs in parallel.
      react: { useSuspense: false },
    });
    return initial;
  })();
  return initPromise;
}

/**
 * Test-only escape hatch: drops the memoized init so a fresh `initI18n()`
 * call in the next test can exercise the full resolution path again. Never
 * call this from production code.
 */
export function __resetI18nForTests(): void {
  initPromise = null;
}

export default i18n;
