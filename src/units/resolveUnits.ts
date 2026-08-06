import type { ResolvedUnits, UnitsPreference } from '../types/units';

export type ResolveUnitsInput = {
  preference: UnitsPreference;
  regionCode?: string | null;
  languageTag?: string | null;
};

/** Resolves a stored preference and optional device locale into display units. */
export function resolveUnits({
  preference,
  regionCode,
  languageTag,
}: ResolveUnitsInput): ResolvedUnits {
  if (preference !== 'system') return preference;

  if (regionCode?.toUpperCase() === 'US') return 'imperial';
  if (languageTag?.toUpperCase().endsWith('-US')) return 'imperial';

  return 'metric';
}
