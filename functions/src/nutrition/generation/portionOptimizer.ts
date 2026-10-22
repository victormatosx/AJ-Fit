import type { MealNutritionTarget, NutritionTotals } from '../shared/types/nutrition';
import type { RawAiFoodItem } from './domain';
import { CORRECTION_SCALE_MIN, CORRECTION_SCALE_MAX, portionStep, validPortion } from './correction';
import { NUTRIENTS, type CorrectionDiagnostic, type Nutrient } from './diagnostics';

/**
 * Deterministic per-food portion adjuster.
 *
 * The existing corrector (`correction.ts`) applies ONE uniform scale factor to every
 * food in a meal. Scaling preserves nutrient ratios by construction, so it can only
 * ever fix a meal whose target ratio already matches the ratio of the AI's chosen
 * foods — e.g. matching calories while fat/fiber come out proportionally wrong is, by
 * definition, unfixable with a single factor. This module instead gives each food its
 * own multiplier, which can shift the mix's net ratio (more of the fattier item, less
 * of the leaner one) without adding, removing, or re-estimating any food.
 *
 * Model: minimize, over per-item multipliers x_i in [CORRECTION_SCALE_MIN, CORRECTION_SCALE_MAX],
 *   sum_nutrient  weight_nutrient * outsideRangePenalty(total_nutrient(x))^2
 * + lambda * sum_i (x_i - 1)^2                                   (stay close to the AI's own portions)
 * where outsideRangePenalty is 0 strictly inside [min,max] and the signed distance to the
 * violated boundary otherwise (a "squared hinge" — zero penalty for any in-range point, so
 * there is no incentive to push a nutrient toward the target once it is already acceptable).
 * weight_nutrient normalizes by that nutrient's own tolerance half-width, so no nutrient's
 * literal magnitude (kcal in the hundreds vs. fiber in single grams) dominates by scale alone.
 *
 * This objective is convex (sum of convex squared-hinge terms in linear total_nutrient(x),
 * plus a convex quadratic regularizer) and separable per coordinate when the others are held
 * fixed, so block coordinate descent — minimizing one x_i at a time via a bounded 1-D search,
 * sweeping repeatedly — provably converges to the GLOBAL optimum of the continuous relaxation.
 * No external solver, no randomness: same inputs always produce the same output.
 *
 * estimatedNutrition is the AI's own value "for that exact quantity" (prompt.ts), already the
 * same linear-scaling assumption `correction.ts`'s uniform-factor corrector relies on — this
 * module makes no stronger assumption about food composition than the mechanism it extends.
 */

const LAMBDA = 0.01;
const SWEEPS = 12;
const GOLDEN_SECTION_ITERATIONS = 60;
const FEASIBILITY_EPSILON = 1e-7;
/** Discrete repair after quantization: bounded local search, not a second optimizer. */
const DISCRETE_REPAIR_SWEEPS = 6;
const DISCRETE_REPAIR_DELTAS = [0.01, 0.02, 0.05, 0.1];

export interface PortionOptimizationResult {
  items: RawAiFoodItem[] | null;
  reason: CorrectionDiagnostic['reason'];
  multipliers: number[] | null;
}

function nutrientVector(item: RawAiFoodItem): number[] {
  return NUTRIENTS.map((nutrient) => item.estimatedNutrition[nutrient]);
}

function nutrientWeights(target: MealNutritionTarget): number[] {
  return NUTRIENTS.map((nutrient) => {
    const range = target[nutrient];
    if (!range) return 0;
    const halfWidth = Math.max((range.max - range.min) / 2, range.target * 0.01, 1e-6);
    return 1 / (halfWidth * halfWidth);
  });
}

/** Zero strictly inside [min,max]; squared distance to the violated boundary otherwise. */
function hingePenalty(observed: number, range: { min: number; max: number } | undefined): number {
  if (!range) return 0;
  if (observed < range.min) return (range.min - observed) ** 2;
  if (observed > range.max) return (observed - range.max) ** 2;
  return 0;
}

function totalForNutrient(vectors: number[][], x: readonly number[], nutrientIndex: number): number {
  let sum = 0;
  for (let i = 0; i < vectors.length; i++) sum += x[i] * vectors[i][nutrientIndex];
  return sum;
}

function objective(vectors: number[][], weights: number[], target: MealNutritionTarget, x: readonly number[]): number {
  let penalty = 0;
  for (let k = 0; k < NUTRIENTS.length; k++) {
    if (!weights[k]) continue;
    const total = totalForNutrient(vectors, x, k);
    penalty += weights[k] * hingePenalty(total, target[NUTRIENTS[k]]);
  }
  let reg = 0;
  for (const xi of x) reg += LAMBDA * (xi - 1) ** 2;
  return penalty + reg;
}

/** 1-D minimization of a convex function over [a,b] — no derivative required. */
function goldenSectionMinimize(f: (value: number) => number, a: number, b: number, iterations: number): number {
  const gr = (Math.sqrt(5) - 1) / 2;
  let lo = a; let hi = b;
  let c = hi - gr * (hi - lo);
  let d = lo + gr * (hi - lo);
  for (let i = 0; i < iterations; i++) {
    if (f(c) < f(d)) hi = d; else lo = c;
    c = hi - gr * (hi - lo);
    d = lo + gr * (hi - lo);
  }
  return (lo + hi) / 2;
}

function continuousSolve(vectors: number[][], weights: number[], target: MealNutritionTarget, n: number): number[] {
  const x = new Array(n).fill(1);
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      const before = x[i];
      const f = (value: number) => {
        const trial = x.slice();
        trial[i] = value;
        return objective(vectors, weights, target, trial);
      };
      const best = goldenSectionMinimize(f, CORRECTION_SCALE_MIN, CORRECTION_SCALE_MAX, GOLDEN_SECTION_ITERATIONS);
      x[i] = best;
      if (Math.abs(best - before) > 1e-5) improved = true;
    }
    if (!improved) break;
  }
  return x;
}

const POCS_SWEEPS = 60;
const POCS_EPSILON = 1e-9;

/** The squared-hinge penalty used by `continuousSolve` is deliberately C1 (zero gradient
 * exactly at the boundary) so coordinate descent is well-behaved — but that same zero
 * gradient means the regularizer's pull toward multiplier=1 can leave the soft optimum a
 * hair outside a nutrient's window even when a truly feasible point exists nearby (the
 * marginal regularization cost of stepping fully inside is positive while the marginal
 * penalty benefit at the boundary is zero). This is a standard alternating-projections
 * (POCS) cleanup pass, warm-started from that near-optimum: project onto each nutrient's
 * slab (a half-space pair, i.e. `min <= a·x <= max`) and the box in turn, repeatedly. POCS
 * provably converges to a point in the intersection of convex sets whenever one exists;
 * starting from the regularized near-optimum keeps the result close to the AI's original
 * portions without reintroducing the boundary-licking problem above. */
function projectOntoSlab(x: number[], vector: readonly number[], range: { min: number; max: number }): number[] {
  let dot = 0; let normSq = 0;
  for (let i = 0; i < x.length; i++) { dot += vector[i] * x[i]; normSq += vector[i] * vector[i]; }
  if (normSq < 1e-12) return x;
  let targetValue: number | null = null;
  if (dot < range.min) targetValue = range.min;
  else if (dot > range.max) targetValue = range.max;
  if (targetValue === null) return x;
  const scale = (targetValue - dot) / normSq;
  return x.map((xi, i) => xi + scale * vector[i]);
}

function pocsSolve(vectors: number[][], ranges: readonly ({ min: number; max: number } | undefined)[], warmStart: readonly number[]): number[] {
  let x = warmStart.slice();
  for (let sweep = 0; sweep < POCS_SWEEPS; sweep++) {
    for (let k = 0; k < NUTRIENTS.length; k++) {
      const range = ranges[k];
      if (!range) continue;
      const column = vectors.map((vector) => vector[k]);
      x = projectOntoSlab(x, column, range);
    }
    x = x.map((xi) => Math.min(CORRECTION_SCALE_MAX, Math.max(CORRECTION_SCALE_MIN, xi)));
    let withinAll = true;
    for (let k = 0; k < NUTRIENTS.length; k++) {
      const range = ranges[k]; if (!range) continue;
      const total = totalForNutrient(vectors, x, k);
      if (total < range.min - POCS_EPSILON || total > range.max + POCS_EPSILON) { withinAll = false; break; }
    }
    if (withinAll) break;
  }
  return x;
}

/** Same single-meal boundary-touching problem `scaleCandidates` already works around
 * (see correction.ts: "independent per-meal 0.01 margins must not accumulate into a daily
 * violation") — landing exactly on a nutrient's boundary in several meals can still sum to
 * a daily-level violation. Bias the search toward a small interior margin first; only fall
 * back to the bare boundary when that stricter region is itself infeasible. */
const INTERIOR_INSET_FRACTION = 0.15;
function pocsCleanup(vectors: number[][], target: MealNutritionTarget, warmStart: readonly number[]): number[] {
  const fullRanges = NUTRIENTS.map((nutrient) => target[nutrient]);
  const insetRanges = fullRanges.map((range) => {
    if (!range) return undefined;
    const inset = (range.max - range.min) * INTERIOR_INSET_FRACTION;
    return { min: range.min + inset, max: Math.max(range.min + inset, range.max - inset) };
  });
  const interior = pocsSolve(vectors, insetRanges, warmStart);
  if (nutrientsWithinRangeLoose(vectors, target, interior)) return interior;
  return pocsSolve(vectors, fullRanges, warmStart);
}

function nutrientsWithinRangeLoose(vectors: number[][], target: MealNutritionTarget, x: readonly number[]): boolean {
  for (let k = 0; k < NUTRIENTS.length; k++) {
    const range = target[NUTRIENTS[k]];
    if (!range) continue;
    const total = totalForNutrient(vectors, x, k);
    if (total < range.min - POCS_EPSILON || total > range.max + POCS_EPSILON) return false;
  }
  return true;
}

function nutrientsWithinRange(vectors: number[][], target: MealNutritionTarget, x: readonly number[]): boolean {
  for (let k = 0; k < NUTRIENTS.length; k++) {
    const range = target[NUTRIENTS[k]];
    if (!range) continue;
    const total = totalForNutrient(vectors, x, k);
    if (hingePenalty(total, range) > FEASIBILITY_EPSILON) return false;
  }
  return true;
}

function quantize(item: RawAiFoodItem, multiplier: number, step: number): RawAiFoodItem {
  const quantity = step === 1 ? Math.round(item.quantity * multiplier) : Math.round(item.quantity * multiplier * 100) / 100;
  const actualFactor = item.quantity > 0 ? quantity / item.quantity : 0;
  const estimatedNutrition = { ...item.estimatedNutrition };
  for (const nutrient of NUTRIENTS) estimatedNutrition[nutrient] = item.estimatedNutrition[nutrient] * actualFactor;
  return { ...item, quantity, estimatedNutrition };
}

function totalsOf(items: readonly RawAiFoodItem[]): NutritionTotals {
  const sums = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
  for (const item of items) for (const nutrient of NUTRIENTS) sums[nutrient] += item.estimatedNutrition[nutrient];
  return sums;
}

function withinAllRanges(total: NutritionTotals, target: MealNutritionTarget): boolean {
  return NUTRIENTS.every((nutrient) => {
    const range = target[nutrient];
    return !range || hingePenalty(total[nutrient], range) === 0;
  });
}

function totalPenalty(total: NutritionTotals, weights: number[], target: MealNutritionTarget): number {
  let penalty = 0;
  for (let k = 0; k < NUTRIENTS.length; k++) {
    const nutrient = NUTRIENTS[k];
    if (!weights[k]) continue;
    penalty += weights[k] * hingePenalty(total[nutrient], target[nutrient]);
  }
  return penalty;
}

/** Bounded discrete local search to recover from the penalty quantization re-introduces.
 * Never adds/removes a food, never leaves the per-item [MIN,MAX] multiplier box. */
function discreteRepair(
  items: readonly RawAiFoodItem[], multipliers: number[], steps: readonly number[],
  weights: number[], target: MealNutritionTarget,
): { items: RawAiFoodItem[]; multipliers: number[] } {
  let current = items.map((item, i) => quantize(item, multipliers[i], steps[i]));
  let currentMultipliers = multipliers.slice();
  let currentPenalty = totalPenalty(totalsOf(current), weights, target);
  for (let sweep = 0; sweep < DISCRETE_REPAIR_SWEEPS && currentPenalty > 0; sweep++) {
    let improvedThisSweep = false;
    for (let i = 0; i < items.length; i++) {
      for (const delta of DISCRETE_REPAIR_DELTAS) {
        for (const sign of [1, -1]) {
          const candidateMultiplier = currentMultipliers[i] + sign * delta;
          if (candidateMultiplier < CORRECTION_SCALE_MIN || candidateMultiplier > CORRECTION_SCALE_MAX) continue;
          const candidateItem = quantize(items[i], candidateMultiplier, steps[i]);
          if (!validPortion(candidateItem)) continue;
          const trial = current.slice();
          trial[i] = candidateItem;
          const trialPenalty = totalPenalty(totalsOf(trial), weights, target);
          if (trialPenalty < currentPenalty - 1e-9) {
            current = trial; currentMultipliers[i] = candidateMultiplier; currentPenalty = trialPenalty; improvedThisSweep = true;
          }
        }
      }
    }
    if (!improvedThisSweep) break;
  }
  return { items: current, multipliers: currentMultipliers };
}

/**
 * Attempts to repair a meal's macro/fiber deviations by giving each already-chosen food
 * its own portion multiplier, instead of one uniform factor for the whole meal.
 * Returns `items: null` (with a reason) whenever no box-feasible, representable repair
 * exists — callers MUST fall back to the existing retry flow, never approve partially.
 */
export function optimizePortions(items: readonly RawAiFoodItem[], target: MealNutritionTarget): PortionOptimizationResult {
  const n = items.length;
  // A single food has one fixed nutrient ratio; no per-item freedom exists to change it —
  // strictly the uniform-scale corrector's job (or, if that also fails, a real retry).
  if (n < 2) return { items: null, reason: 'optimizer_infeasible', multipliers: null };
  const steps = items.map((item) => portionStep(item.unit));
  if (steps.some((step) => step === null)) return { items: null, reason: 'ambiguous_unit', multipliers: null };
  const vectors = items.map(nutrientVector);
  const weights = nutrientWeights(target);
  // A nutrient whose every item estimate is zero cannot be moved by any multiplier;
  // treat exactly like the uniform corrector does (zero is only a problem if the target forbids it).
  for (let k = 0; k < NUTRIENTS.length; k++) {
    const range = target[NUTRIENTS[k] as Nutrient];
    if (range && vectors.every((vector) => vector[k] === 0) && range.min > FEASIBILITY_EPSILON) {
      return { items: null, reason: 'zero_nutrient', multipliers: null };
    }
  }
  const softOptimum = continuousSolve(vectors, weights, target, n);
  const continuous = pocsCleanup(vectors, target, softOptimum).map((xi) =>
    Math.min(CORRECTION_SCALE_MAX, Math.max(CORRECTION_SCALE_MIN, xi)));
  if (!nutrientsWithinRange(vectors, target, continuous)) {
    return { items: null, reason: 'optimizer_infeasible', multipliers: null };
  }
  const resolvedSteps = steps as number[];
  const repaired = discreteRepair(items, continuous, resolvedSteps, weights, target);
  if (!repaired.items.every(validPortion) || !repaired.items.every((item) => Number.isFinite(item.quantity))) {
    return { items: null, reason: 'invalid_portion', multipliers: null };
  }
  const finalTotal = totalsOf(repaired.items);
  if (!withinAllRanges(finalTotal, target)) {
    return { items: null, reason: 'quantized_out_of_range', multipliers: null };
  }
  return { items: repaired.items, reason: null, multipliers: repaired.multipliers };
}
