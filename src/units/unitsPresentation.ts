import type { ResolvedUnits, UnitsPreference } from '../types/units';

export type UnitsSummaryKey =
  | 'settings:units.summary.systemMetric'
  | 'settings:units.summary.systemImperial'
  | 'settings:units.summary.metric'
  | 'settings:units.summary.imperial';

export function getUnitsSummaryKey(
  preference: UnitsPreference,
  resolved: ResolvedUnits,
): UnitsSummaryKey {
  if (preference === 'system') {
    return resolved === 'metric'
      ? 'settings:units.summary.systemMetric'
      : 'settings:units.summary.systemImperial';
  }
  return `settings:units.summary.${preference}`;
}
