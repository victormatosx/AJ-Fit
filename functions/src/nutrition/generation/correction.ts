import type { MealNutritionTarget, NutritionTotals } from '../shared/types/nutrition';
import type { RawAiFoodItem } from './domain';
import { NUTRIENTS, ROUNDING_MARGIN, type CorrectionDiagnostic } from './diagnostics';

function normalizedUnit(unit: string): string {
  return unit.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}
// No conversions between units and no inference from food names. Unknown units
// may be returned unchanged, but cannot be scaled safely without a defined step.
export function portionStep(unit: string): number | null {
  const normalized = normalizedUnit(unit);
  if (['unidade', 'unidades', 'un', 'un.', 'und', 'und.', 'unid', 'unid.', 'fatia', 'fatias', 'ovo', 'ovos', 'capsula', 'capsulas', 'comprimido', 'comprimidos'].includes(normalized)) return 1;
  if (['g', 'grama', 'gramas', 'kg', 'ml', 'l', 'xicara', 'xicaras', 'colher de sopa', 'colheres de sopa', 'colher de cha', 'colheres de cha'].includes(normalized)) return 0.01;
  return null;
}
export function validPortion(item: RawAiFoodItem): boolean {
  return Number.isFinite(item.quantity) && item.quantity > 0 && item.quantity <= 5000
    && (portionStep(item.unit) !== 1 || Number.isInteger(item.quantity));
}

/** Intersect ALL nutrient bounds with the existing [0.5, 2] correction budget.
 * Zero nutrients impose no bound only if zero itself is allowed. Actual rounded
 * totals and quantized portions must still pass the ordinary validator. */
export function admissibleScale(total: NutritionTotals, target: MealNutritionTarget): {
  interval: { min: number; max: number } | null; reason: CorrectionDiagnostic['reason'];
} {
  let min = 0.5; let max = 2;
  for (const nutrient of NUTRIENTS) {
    const range = target[nutrient];
    if (!range) continue;
    const observed = total[nutrient];
    if (observed === 0) {
      if (range.min - ROUNDING_MARGIN > 0) return { interval: null, reason: 'zero_nutrient' };
      continue;
    }
    min = Math.max(min, (range.min - ROUNDING_MARGIN) / observed);
    max = Math.min(max, (range.max + ROUNDING_MARGIN) / observed);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || max <= 0) {
    return { interval: null, reason: 'empty_intersection' };
  }
  return { interval: { min, max }, reason: null };
}

export function scaledPortions(items: readonly RawAiFoodItem[], factor: number): {
  items: RawAiFoodItem[] | null; reason: CorrectionDiagnostic['reason'];
} {
  const scaled: RawAiFoodItem[] = [];
  if (!Number.isFinite(factor) || factor <= 0) return { items: null, reason: 'invalid_portion' };
  for (const item of items) {
    const step = portionStep(item.unit);
    if (step === null) return { items: null, reason: 'ambiguous_unit' };
    // Refuse rather than clamp to a fabricated minimum/maximum.
    const quantity = step === 1 ? Math.round(item.quantity * factor) : Math.round(item.quantity * factor * 100) / 100;
    const actualFactor = quantity / item.quantity;
    const proposal: RawAiFoodItem = { ...item, quantity,
      estimatedNutrition: { ...item.estimatedNutrition } };
    for (const nutrient of NUTRIENTS) proposal.estimatedNutrition[nutrient] *= actualFactor;
    if (!validPortion(proposal)) return { items: null, reason: 'invalid_portion' };
    scaled.push(proposal);
  }
  return { items: scaled, reason: null };
}

/** Bounded candidates near one, then interior points to survive
 * quantization at an inclusive boundary. This is deliberately not a combinatorial
 * portion optimizer; any unrepresentable correction goes to the existing retry. */
export function scaleCandidates(interval: { min: number; max: number }): number[] {
  const nearest = Math.max(interval.min, Math.min(1, interval.max));
  const width = interval.max - interval.min;
  // Prefer a small interior inset: independent per-meal 0.01 margins must not
  // accumulate into a daily violation. Zero-width inclusive intervals still work.
  return [...new Set([nearest + (nearest <= 1 ? -1 : 1) * width * 0.01, nearest,
    (interval.min + interval.max) / 2, interval.min, interval.max])]
    .filter((factor) => factor >= interval.min && factor <= interval.max);
}
