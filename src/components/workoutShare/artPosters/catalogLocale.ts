/**
 * Same i18n-language → exercise-catalog-locale mapping
 * `PersonalRecordsSection` already uses — pulled out so the ARTE PR poster
 * doesn't duplicate the ternary.
 */
export function workoutShareArtCatalogLocale(i18nLanguage: string): 'ptBR' | 'en' | 'es' {
  if (i18nLanguage === 'pt-BR') return 'ptBR';
  if (i18nLanguage === 'es') return 'es';
  return 'en';
}
