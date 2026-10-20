import {
  CM_PER_INCH,
  INCHES_PER_FOOT,
} from '../../units/heightConversions';
import { kgToLb, lbToKg } from '../../units/weightConversions';
import type { ResolvedUnits } from '../../types/units';

/**
 * Display-side unit handling for the questionnaire's ruler steps.
 *
 * This module is presentation only, and deliberately lives outside
 * `src/units`: the stored answer never changes unit. `height` is always
 * written in centimetres and `weight` always in kilograms, exactly as
 * before — these helpers only decide what the ruler *shows* and how a
 * position on it maps back to the canonical number.
 *
 * The conversion constants themselves are NOT redefined here; they are
 * re-used from `src/units`, which is the app's single source of truth for
 * them (`CM_PER_INCH`, and `kgToLb`/`lbToKg` whose `LB_PER_KG` is the exact
 * reciprocal of the design's 0.45359237).
 */

/** A unit the ruler can be displayed in. `cm`/`kg` are also the stored ones. */
export type DisplayUnit = 'cm' | 'ft' | 'kg' | 'lb';

/** Which pair of units a ruler step offers. */
export type MeasurementKind = 'height' | 'weight';

export const MEASUREMENT_UNITS: Readonly<Record<MeasurementKind, readonly [DisplayUnit, DisplayUnit]>> = {
  height: ['cm', 'ft'],
  weight: ['kg', 'lb'],
};

/** The unit a measurement is stored in, whatever the ruler is showing. */
export function canonicalUnit(kind: MeasurementKind): DisplayUnit {
  return kind === 'height' ? 'cm' : 'kg';
}

export function measurementKindOf(unit: DisplayUnit): MeasurementKind {
  return unit === 'cm' || unit === 'ft' ? 'height' : 'weight';
}

/** Whether the unit is the metric (and therefore canonical) one of its pair. */
export function isCanonicalUnit(unit: DisplayUnit): boolean {
  return unit === 'cm' || unit === 'kg';
}

/**
 * The display unit a resolved app-wide preference corresponds to. Used to
 * seed the toggle, never to decide what gets stored.
 */
export function unitForPreference(kind: MeasurementKind, units: ResolvedUnits): DisplayUnit {
  const [metric, imperial] = MEASUREMENT_UNITS[kind];
  return units === 'imperial' ? imperial : metric;
}

/** The resolved-units value a display unit corresponds to. */
export function preferenceForUnit(unit: DisplayUnit): ResolvedUnits {
  return isCanonicalUnit(unit) ? 'metric' : 'imperial';
}

/**
 * Canonical (cm/kg) -> the whole number the ruler shows.
 *
 * Every ruler tick is one whole display unit, so this rounds: a height of
 * 178 cm shows as 70 in (5′10″), a weight of 78 kg as 172 lb.
 */
export function toDisplayValue(canonical: number, unit: DisplayUnit): number {
  switch (unit) {
    case 'cm':
    case 'kg':
      return Math.round(canonical);
    case 'ft':
      return Math.round(canonical / CM_PER_INCH);
    case 'lb':
      return Math.round(kgToLb(canonical));
  }
}

/**
 * A whole number on the ruler -> the canonical value to store.
 *
 * Rounded to the canonical step (whole cm / whole kg, which is what every
 * metric tick is) so that what gets written is indistinguishable in format
 * from what a metric ruler would have written. Without this the stored
 * answer would pick up a fractional tail — 172 lb would store
 * 78.0176… kg — and drift further on every unit switch.
 *
 * `bounds` is the canonical min/max from `questionDefs.ts`. It matters
 * because an imperial range rounded outward can convert back to just past
 * the canonical one: 220 cm shows as 87 in, and 87 in is 220.98 cm. The
 * questionnaire's declared range is the contract, so the edge tick stores
 * the boundary rather than a value outside it.
 */
export function toCanonicalValue(
  display: number,
  unit: DisplayUnit,
  bounds?: { min: number; max: number },
): number {
  const exact = (() => {
    switch (unit) {
      case 'cm':
      case 'kg':
        return Math.round(display);
      case 'ft':
        return Math.round(display * CM_PER_INCH);
      case 'lb':
        return Math.round(lbToKg(display));
    }
  })();
  if (!bounds) return exact;
  return Math.max(bounds.min, Math.min(bounds.max, exact));
}

/** Total inches -> the design's typographic `5′10″`. */
export function formatFeetInches(totalInches: number): string {
  const feet = Math.floor(totalInches / INCHES_PER_FOOT);
  const inches = totalInches % INCHES_PER_FOOT;
  return `${feet}′${inches}″`;
}

/** What the big number reads, for a value already in display units. */
export function formatDisplayValue(display: number, unit: DisplayUnit): string {
  return unit === 'ft' ? formatFeetInches(display) : String(display);
}

/**
 * The ruler's min/max in display units, derived from the canonical range
 * declared in `questionDefs.ts` — never hardcoded. 140–220 cm becomes
 * 55–87 in (4′7″–7′3″); 40–180 kg becomes 88–397 lb.
 */
export function toDisplayRange(
  minCanonical: number,
  maxCanonical: number,
  unit: DisplayUnit,
): { min: number; max: number } {
  return {
    min: toDisplayValue(minCanonical, unit),
    max: toDisplayValue(maxCanonical, unit),
  };
}

/**
 * How often the ruler draws a taller tick. Feet group in twelves (one per
 * whole foot); every other unit groups in fives.
 */
export function majorTickEvery(unit: DisplayUnit): number {
  return unit === 'ft' ? INCHES_PER_FOOT : 5;
}

/**
 * Whether the big number can be typed into. Feet-and-inches is a composed
 * display (`5′10″`), not a number a numeric keypad can produce, so that mode
 * is ruler-only — same as the prototype.
 */
export function supportsKeyboardEntry(unit: DisplayUnit): boolean {
  return unit !== 'ft';
}

/** The short unit label shown beside the number; feet carries none. */
export function unitLabelKey(unit: DisplayUnit): string | null {
  return unit === 'ft' ? null : `units.${unit}`;
}
