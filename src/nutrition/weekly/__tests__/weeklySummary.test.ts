import { describe, expect, it } from 'vitest';
import type { NutritionDailyLog, NutritionPlan, NutritionTotals } from '../../../types/nutrition';
import {
  buildNutritionWeeklySummary, buildNutritionWeeklyWeightSummary, type TimestampLike,
} from '..';

class TestTimestamp implements TimestampLike {
  constructor(private readonly date: Date) {}
  toDate() { return new Date(this.date); }
  toMillis() { return this.date.getTime(); }
}

const ts = (iso: string) => new TestTimestamp(new Date(iso));
const totals = (kcal: number, proteinG = kcal / 10, carbsG = kcal / 5, fatG = kcal / 40, fiberG = kcal / 100): NutritionTotals => (
  { kcal, proteinG, carbsG, fatG, fiberG }
);

function log(localDate: string, kcal: number, options: { meals?: number; followed?: number; fiberKnown?: boolean } = {}): NutritionDailyLog<TestTimestamp> {
  const mealCount = options.meals ?? 1;
  const followed = options.followed ?? 0;
  const dayTotals = totals(kcal);
  return {
    localDate, timezone: 'America/Sao_Paulo', totals: dayTotals, loggedItemCount: mealCount,
    meals: Array.from({ length: mealCount }, (_, index) => ({
      slot: (['breakfast', 'lunch', 'dinner'] as const)[index] ?? 'supper',
      ...(index < followed ? { followedRecommendedOptionId: `option-${index}` } : {}),
      totals: totals(kcal / Math.max(1, mealCount)),
      items: [{
        id: `item-${index}`, foodId: `food-${index}`, grams: 100, source: 'catalog_food', loggedAt: ts(`${localDate}T12:00:00-03:00`),
        snapshot: {
          name: 'Food', ...totals(kcal / Math.max(1, mealCount)),
          ...(options.fiberKnown === false ? { fiberG: null } : {}),
        },
      }],
    })),
    createdAt: ts(`${localDate}T12:00:00-03:00`), updatedAt: ts(`${localDate}T12:00:00-03:00`),
  };
}

function zeroLog(localDate: string): NutritionDailyLog<TestTimestamp> {
  return { localDate, timezone: 'America/Sao_Paulo', meals: [], totals: totals(0), loggedItemCount: 0,
    createdAt: ts(`${localDate}T12:00:00-03:00`), updatedAt: ts(`${localDate}T12:00:00-03:00`) };
}

function plan(id: string, kcal: number, createdIso: string, options: { archivedIso?: string; activatedIso?: string; status?: 'active' | 'archived' } = {}): NutritionPlan<TestTimestamp> {
  const createdAt = ts(createdIso);
  const target = totals(kcal);
  return {
    planId: id, generationId: id, status: options.status ?? (options.archivedIso ? 'archived' : 'active'),
    createdAt, activatedAt: ts(options.activatedIso ?? createdIso), archivedAt: options.archivedIso ? ts(options.archivedIso) : null,
    profileSnapshot: { questionnaireVersion: 1, inherited: {
      sex: 'm', ageYears: 30, heightCm: 180, currentWeightKg: 80, goal: 'health',
    }, nutritionAnswers: {} as never, capturedAt: createdAt },
    physicalSnapshot: {} as never,
    engineSnapshot: { output: {
      eligible: true, blockers: [], energy: { rmrKcal: 1700, tdeeKcal: kcal, targetKcal: kcal, safetyClampApplied: false },
      macros: { proteinG: target.proteinG, carbsG: target.carbsG, fatG: target.fatG, fiberG: target.fiberG },
      mealTargets: [], calculationTrace: {}, versions: {} as never,
    }, ruleVersions: {} as never },
    meals: [], dailyTotals: target,
    generationMetadata: { provider: 'test', model: 'test', attempts: 1, corrected: false, fallbackUsed: false },
    versions: {} as never,
  };
}

describe('buildNutritionWeeklySummary', () => {
  it('aggregates seven complete days, all meals, totals and followed recommended options', () => {
    const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
    const summary = buildNutritionWeeklySummary({
      weekStartLocalDate: dates[0]!, plans: [plan('a', 2100, '2026-10-01T12:00:00-03:00')],
      logs: dates.map((date, index) => log(date, 1800 + index * 100, { meals: 2, followed: 1 })),
    });
    expect(summary.recordedDays).toBe(7);
    expect(summary.totalMeals).toBe(14);
    expect(summary.followedRecommendedMeals).toBe(7);
    expect(summary.averageConsumed?.kcal).toBe(2100);
    expect(summary.averageTarget?.kcal).toBe(2100);
    expect(summary.targetDays).toBe(7);
  });

  it('does not count missing days as zero and distinguishes an explicit zero log', () => {
    const summary = buildNutritionWeeklySummary({
      weekStartLocalDate: '2026-10-05', plans: [],
      logs: [log('2026-10-05', 1800), log('2026-10-07', 2100), zeroLog('2026-10-11')],
    });
    expect(summary.recordedDays).toBe(3);
    expect(summary.averageConsumed?.kcal).toBe(1300);
    expect(summary.days[1]).toMatchObject({ hasLog: false, totals: null });
    expect(summary.days[6]).toMatchObject({ hasLog: true, totals: totals(0) });
  });

  it('reports fiber only from days whose logged items have known fiber', () => {
    const summary = buildNutritionWeeklySummary({
      weekStartLocalDate: '2026-10-05', plans: [],
      logs: [log('2026-10-05', 2000, { fiberKnown: true }), log('2026-10-06', 1800, { fiberKnown: false })],
    });
    expect(summary.averageFiberG).toBe(20);
    expect(summary.fiberRecordedDays).toBe(1);
    expect(summary.days[1]?.fiberG).toBeNull();
    const unknownOnly = buildNutritionWeeklySummary({
      weekStartLocalDate: '2026-10-05', plans: [], logs: [log('2026-10-05', 1800, { fiberKnown: false })],
    });
    expect(unknownOnly.averageFiberG).toBeNull();
  });

  it('reflects an edited item through the recalculated persisted day totals', () => {
    const before = buildNutritionWeeklySummary({ weekStartLocalDate: '2026-10-05', plans: [], logs: [log('2026-10-05', 1000)] });
    const after = buildNutritionWeeklySummary({ weekStartLocalDate: '2026-10-05', plans: [], logs: [log('2026-10-05', 1400)] });
    expect(before.averageConsumed?.kcal).toBe(1000);
    expect(after.averageConsumed?.kcal).toBe(1400);
  });

  it('uses the plan active on each day when a plan changes midweek', () => {
    const summary = buildNutritionWeeklySummary({
      weekStartLocalDate: '2026-10-05', logs: [], plans: [
        plan('a', 2000, '2026-10-01T09:00:00-03:00', { archivedIso: '2026-10-08T09:00:00-03:00' }),
        plan('b', 2400, '2026-10-08T09:00:00-03:00'),
      ],
    });
    expect(summary.days.map((day) => day.targetPlanId)).toEqual(['a', 'a', 'a', 'b', 'b', 'b', 'b']);
    expect(summary.averageTarget?.kcal).toBeCloseTo((3 * 2000 + 4 * 2400) / 7);
    expect(summary.planIds).toEqual(['a', 'b']);
  });

  it('reconstructs the original period of a restored archived plan from creation order', () => {
    const summary = buildNutritionWeeklySummary({
      weekStartLocalDate: '2026-10-05', logs: [], plans: [
        plan('a', 2000, '2026-10-05T08:00:00-03:00', { activatedIso: '2026-10-11T18:00:00-03:00' }),
        plan('b', 2400, '2026-10-08T08:00:00-03:00', { archivedIso: '2026-10-11T18:00:00-03:00' }),
      ],
    });
    expect(summary.days.map((day) => day.targetPlanId)).toEqual(['a', 'a', 'a', 'b', 'b', 'b', 'a']);
  });
});

describe('buildNutritionWeeklyWeightSummary', () => {
  const assessment = (id: string, weight: number, iso: string) => ({ id, weight, measuredAt: ts(iso) });

  it('handles zero and one assessment without a false trend', () => {
    expect(buildNutritionWeeklyWeightSummary({ weekEndLocalDate: '2026-10-11', assessments: [] }).latest).toBeNull();
    const one = buildNutritionWeeklyWeightSummary({
      weekEndLocalDate: '2026-10-11', assessments: [assessment('a', 78.4, '2026-10-10T12:00:00-03:00')], targetWeightKg: 75,
    });
    expect(one.latest?.weightKg).toBe(78.4);
    expect(one.deltaKg).toBeNull();
    expect(one.trendDirection).toBe('insufficient');
    expect(one.targetWeightKg).toBe(75);
  });

  it('selects latest and previous as of that week and derives a recent trend only with enough points', () => {
    const summary = buildNutritionWeeklyWeightSummary({ weekEndLocalDate: '2026-10-11', assessments: [
      assessment('future', 76, '2026-10-12T08:00:00-03:00'),
      assessment('latest', 78.4, '2026-10-10T08:00:00-03:00'),
      assessment('previous', 79.1, '2026-10-03T08:00:00-03:00'),
      assessment('oldest', 79.8, '2026-09-20T08:00:00-03:00'),
    ] });
    expect(summary.latest?.id).toBe('latest');
    expect(summary.previous?.id).toBe('previous');
    expect(summary.deltaKg).toBeCloseTo(-0.7);
    expect(summary.trendDeltaKg).toBeCloseTo(-1.4);
    expect(summary.trendDirection).toBe('down');
    expect(summary.points.map((point) => point.id)).toEqual(['oldest', 'previous', 'latest']);
  });
});
