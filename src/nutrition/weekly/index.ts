import type { NutritionDailyLog, NutritionPlan, NutritionTotals } from '../../types/nutrition';
import { localWeekDates, shiftLocalDate, toLocalDateString } from '../ui/localDate';

export interface TimestampLike {
  toDate(): Date;
  toMillis?: () => number;
}

export interface NutritionWeeklyDay {
  localDate: string;
  hasLog: boolean;
  totals: NutritionTotals | null;
  fiberG: number | null;
  mealCount: number;
  followedRecommendedCount: number;
  target: NutritionTotals | null;
  targetPlanId: string | null;
}

export interface NutritionWeeklySummary {
  weekStartLocalDate: string;
  weekEndLocalDate: string;
  days: NutritionWeeklyDay[];
  recordedDays: number;
  totalMeals: number;
  followedRecommendedMeals: number;
  averageConsumed: NutritionTotals | null;
  averageFiberG: number | null;
  fiberRecordedDays: number;
  averageTarget: NutritionTotals | null;
  targetDays: number;
  planIds: string[];
}

export interface NutritionWeightPoint {
  id: string;
  weightKg: number;
  measuredAt: Date;
  localDate: string;
}

export interface NutritionWeeklyWeightSummary {
  latest: NutritionWeightPoint | null;
  previous: NutritionWeightPoint | null;
  deltaKg: number | null;
  trendDeltaKg: number | null;
  trendDirection: 'up' | 'down' | 'stable' | 'insufficient';
  points: NutritionWeightPoint[];
  targetWeightKg: number | null;
}

type WeeklyLog = NutritionDailyLog<TimestampLike>;
type WeeklyPlan = NutritionPlan<TimestampLike>;

function timestampMs(value: TimestampLike): number {
  return value.toMillis?.() ?? value.toDate().getTime();
}

function planTarget(plan: WeeklyPlan): NutritionTotals {
  return {
    kcal: plan.engineSnapshot.output.energy.targetKcal,
    proteinG: plan.engineSnapshot.output.macros.proteinG,
    carbsG: plan.engineSnapshot.output.macros.carbsG,
    fatG: plan.engineSnapshot.output.macros.fatG,
    fiberG: plan.engineSnapshot.output.macros.fiberG,
  };
}

interface PlanPeriod {
  plan: WeeklyPlan;
  startDate: string;
  startMs: number;
  endDateInclusive: string | null;
  endDateExclusive: string | null;
}

/**
 * Each generated plan's first active period begins at createdAt. A later plan
 * creation closes it. activatedAt/archivedAt add the current or most recently
 * represented lifecycle period, including restores. Intermediate repeated
 * restores cannot be reconstructed because the persisted model overwrites
 * activatedAt; unresolved days stay without a target instead of guessing.
 */
function planPeriods(plans: readonly WeeklyPlan[]): PlanPeriod[] {
  const chronological = [...plans].sort((a, b) => timestampMs(a.createdAt) - timestampMs(b.createdAt));
  const periods: PlanPeriod[] = [];
  chronological.forEach((plan, index) => {
    const createdAt = plan.createdAt.toDate();
    const next = chronological[index + 1];
    periods.push({
      plan,
      startDate: toLocalDateString(createdAt),
      startMs: timestampMs(plan.createdAt),
      endDateInclusive: !next && plan.archivedAt ? toLocalDateString(plan.archivedAt.toDate()) : null,
      endDateExclusive: next ? toLocalDateString(next.createdAt.toDate()) : null,
    });

    const activatedMs = timestampMs(plan.activatedAt);
    if (activatedMs !== timestampMs(plan.createdAt) || plan.archivedAt) {
      periods.push({
        plan,
        startDate: toLocalDateString(plan.activatedAt.toDate()),
        startMs: activatedMs,
        endDateInclusive: plan.archivedAt ? toLocalDateString(plan.archivedAt.toDate()) : null,
        endDateExclusive: null,
      });
    }
  });
  return periods;
}

function planForDate(periods: readonly PlanPeriod[], localDate: string): WeeklyPlan | null {
  return periods
    .filter((period) => period.startDate <= localDate
      && (!period.endDateExclusive || localDate < period.endDateExclusive)
      && (!period.endDateInclusive || localDate <= period.endDateInclusive))
    .sort((a, b) => b.startMs - a.startMs)[0]?.plan ?? null;
}

function averageTotals(values: readonly NutritionTotals[]): NutritionTotals | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => ({
    kcal: sum.kcal + value.kcal,
    proteinG: sum.proteinG + value.proteinG,
    carbsG: sum.carbsG + value.carbsG,
    fatG: sum.fatG + value.fatG,
    fiberG: sum.fiberG + value.fiberG,
  }), { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 });
  return {
    kcal: total.kcal / values.length,
    proteinG: total.proteinG / values.length,
    carbsG: total.carbsG / values.length,
    fatG: total.fatG / values.length,
    fiberG: total.fiberG / values.length,
  };
}

function knownFiberForDay(log: WeeklyLog): number | null {
  const items = log.meals.flatMap((meal) => meal.items);
  if (items.some((item) => item.snapshot.fiberG == null)) return null;
  return log.totals.fiberG;
}

export function buildNutritionWeeklySummary(input: {
  weekStartLocalDate: string;
  logs: readonly WeeklyLog[];
  plans: readonly WeeklyPlan[];
}): NutritionWeeklySummary {
  const dates = localWeekDates(input.weekStartLocalDate);
  const logsByDate = new Map(input.logs.map((log) => [log.localDate, log]));
  const periods = planPeriods(input.plans);
  const days = dates.map((localDate): NutritionWeeklyDay => {
    const log = logsByDate.get(localDate) ?? null;
    const plan = planForDate(periods, localDate);
    const loggedMeals = log?.meals.filter((meal) => meal.items.length > 0) ?? [];
    return {
      localDate,
      hasLog: log != null,
      totals: log?.totals ?? null,
      fiberG: log ? knownFiberForDay(log) : null,
      mealCount: loggedMeals.length,
      followedRecommendedCount: loggedMeals.filter((meal) => Boolean(meal.followedRecommendedOptionId)).length,
      target: plan ? planTarget(plan) : null,
      targetPlanId: plan?.planId ?? null,
    };
  });
  const recorded = days.filter((day) => day.hasLog);
  const fiberDays = recorded.filter((day) => day.fiberG != null);
  const targetDays = days.filter((day) => day.target != null);
  return {
    weekStartLocalDate: dates[0]!,
    weekEndLocalDate: dates[6]!,
    days,
    recordedDays: recorded.length,
    totalMeals: recorded.reduce((sum, day) => sum + day.mealCount, 0),
    followedRecommendedMeals: recorded.reduce((sum, day) => sum + day.followedRecommendedCount, 0),
    averageConsumed: averageTotals(recorded.flatMap((day) => day.totals ? [day.totals] : [])),
    averageFiberG: fiberDays.length
      ? fiberDays.reduce((sum, day) => sum + (day.fiberG ?? 0), 0) / fiberDays.length
      : null,
    fiberRecordedDays: fiberDays.length,
    averageTarget: averageTotals(targetDays.flatMap((day) => day.target ? [day.target] : [])),
    targetDays: targetDays.length,
    planIds: [...new Set(targetDays.flatMap((day) => day.targetPlanId ? [day.targetPlanId] : []))],
  };
}

export function buildNutritionWeeklyWeightSummary(input: {
  weekEndLocalDate: string;
  assessments: readonly { id: string; weight: number; measuredAt: TimestampLike }[];
  targetWeightKg?: number | null;
  maxPoints?: number;
}): NutritionWeeklyWeightSummary {
  const eligible = input.assessments
    .map((assessment): NutritionWeightPoint => ({
      id: assessment.id,
      weightKg: assessment.weight,
      measuredAt: assessment.measuredAt.toDate(),
      localDate: toLocalDateString(assessment.measuredAt.toDate()),
    }))
    .filter((point) => point.localDate <= input.weekEndLocalDate)
    .sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime());
  const latest = eligible[0] ?? null;
  const previous = eligible[1] ?? null;
  const points = eligible.slice(0, input.maxPoints ?? 8).reverse();
  const deltaKg = latest && previous ? latest.weightKg - previous.weightKg : null;
  const trendDeltaKg = points.length >= 3 ? points[points.length - 1]!.weightKg - points[0]!.weightKg : null;
  return {
    latest,
    previous,
    deltaKg,
    trendDeltaKg,
    trendDirection: trendDeltaKg == null ? 'insufficient' : trendDeltaKg > 0 ? 'up' : trendDeltaKg < 0 ? 'down' : 'stable',
    points,
    targetWeightKg: input.targetWeightKg ?? null,
  };
}

export function previousNutritionWeek(weekStartLocalDate: string): string {
  return shiftLocalDate(weekStartLocalDate, -7);
}

export function nextNutritionWeek(weekStartLocalDate: string): string {
  return shiftLocalDate(weekStartLocalDate, 7);
}
