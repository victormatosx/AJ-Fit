export const UNITS_PREFERENCES = ['system', 'metric', 'imperial'] as const;

export type UnitsPreference = (typeof UNITS_PREFERENCES)[number];

export type ResolvedUnits = Exclude<UnitsPreference, 'system'>;

export const DEFAULT_UNITS_PREFERENCE: UnitsPreference = 'system';

export function isUnitsPreference(value: unknown): value is UnitsPreference {
  return (
    typeof value === 'string' &&
    (UNITS_PREFERENCES as readonly string[]).includes(value)
  );
}
