import type { SupportedLanguage } from '../types/language';

/**
 * Maps any BCP-47 language tag (or arbitrary input) to a SupportedLanguage.
 *
 *   pt / pt-BR / pt-PT / pt-*   → 'pt-BR'
 *   en / en-*                   → 'en'
 *   es / es-*                   → 'es'
 *   anything else / empty / bad → 'en'
 *
 * Pure, sync, and dependency-free — no React, no AsyncStorage, no Firebase.
 * Matching is case-insensitive so that `pt-br`, `PT-BR` and `pt-BR` all
 * resolve identically; this is defensive because callers hand us input from
 * the OS, from AsyncStorage, and from future Firestore reads, and each source
 * normalizes casing differently.
 *
 * Note: 'en' is the *fallback* here (unsupported inputs), which is distinct
 * from DEFAULT_LANGUAGE (currently 'pt-BR', used only when provisioning a
 * brand-new user document).
 */
export function normalizeLanguage(input: unknown): SupportedLanguage {
  if (typeof input !== 'string') return 'en';
  const tag = input.trim().toLowerCase();
  if (!tag) return 'en';

  const primary = tag.split('-')[0];
  if (primary === 'pt') return 'pt-BR';
  if (primary === 'en') return 'en';
  if (primary === 'es') return 'es';
  return 'en';
}
