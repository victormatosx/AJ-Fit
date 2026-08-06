import { getLocales } from 'expo-localization';
import type { ResolvedUnits, UnitsPreference } from '../types/units';
import { resolveUnits } from './resolveUnits';

/** Resolves against fresh device locale data whenever it is called. */
export function resolveCurrentUnits(preference: UnitsPreference): ResolvedUnits {
  const locale = getLocales()[0];

  return resolveUnits({
    preference,
    regionCode: locale?.regionCode ?? null,
    languageTag: locale?.languageTag ?? null,
  });
}
