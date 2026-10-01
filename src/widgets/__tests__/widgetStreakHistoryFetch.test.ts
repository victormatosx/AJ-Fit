import { describe, expect, it, vi } from 'vitest';
import {
  fetchWidgetStreakHistory,
  WIDGET_STREAK_BASE_LOOKBACK_DAYS,
  WIDGET_STREAK_MAX_LOOKBACK_DAYS,
  type CompletedWorkoutActivityDatesFetcher,
} from '../widgetStreakHistoryFetch';

const baseStreakInput = {
  trainingDays: ['MON', 'WED', 'FRI'] as const,
  activeRecoveryDays: [],
};

/** Every MON/WED/FRI between `from` and `to`, inclusive, as an unbroken completed run. */
function unbrokenCompletionsFetcher() {
  return vi.fn(async (_uid: string, from: string, to: string) => {
    const performed: string[] = [];
    let cursor = from;
    const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
    while (cursor <= to) {
      const day = weekdayOf(cursor);
      if (day === 1 || day === 3 || day === 5) performed.push(cursor); // Mon/Wed/Fri
      const next = new Date(`${cursor}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      cursor = next.toISOString().slice(0, 10);
    }
    return { performedDates: performed, scheduledDates: [] };
  });
}

describe('fetchWidgetStreakHistory', () => {
  it('a real gap within the base window costs exactly ONE query', async () => {
    const fetchRange: CompletedWorkoutActivityDatesFetcher = vi.fn(async () => ({
      performedDates: ['2026-09-11'], // Fri only — Wed (09-09) missing, real break
      scheduledDates: [],
    }));

    const result = await fetchWidgetStreakHistory({
      uid: 'u1',
      todayLocalDate: '2026-09-11',
      streakInput: baseStreakInput,
      fetchRange,
    });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(result.lookbackDaysUsed).toBe(WIDGET_STREAK_BASE_LOOKBACK_DAYS);
    expect(result.streak).toEqual({ scheduleMode: 'fixed', unit: 'obligations', current: 1, complete: true });
    expect(result.historyAvailableFromLocalDate).toBe('2026-03-15'); // today - 180 days
  });

  it('an unbroken streak longer than the base window triggers incremental doubling until a break or the cap', async () => {
    // Completions only exist from 2026-01-01 onward (a real, if long, streak) — beyond that, nothing.
    const fetchRange = vi.fn(async (_uid: string, from: string, to: string) => {
      const unbroken = unbrokenCompletionsFetcher();
      const { performedDates } = await unbroken('u1', from < '2026-01-01' ? '2026-01-01' : from, to);
      return { performedDates, scheduledDates: [] as string[] };
    });

    const result = await fetchWidgetStreakHistory({
      uid: 'u1',
      todayLocalDate: '2026-09-11',
      streakInput: baseStreakInput,
      fetchRange,
    });

    // 180 days from 09-11 lands at 2026-03-15 (after 2026-01-01, so the run
    // continues past the fetched window) -> doubles to 360 -> lands before
    // 2026-01-01 -> the fetch itself finds the real gap (nothing before
    // Jan 1) and reports complete: true.
    expect(fetchRange.mock.calls.length).toBeGreaterThan(1);
    expect(result.streak.complete).toBe(true);
    expect(result.streak.current).toBeGreaterThan(0);
  });

  it('never reports a result as exact beyond the hard safety cap — complete stays false', async () => {
    // Pathological: completions exist for the ENTIRE cap window and beyond — no real gap ever found.
    const fetchRange = unbrokenCompletionsFetcher();

    const result = await fetchWidgetStreakHistory({
      uid: 'u1',
      todayLocalDate: '2026-09-11',
      streakInput: baseStreakInput,
      fetchRange,
    });

    expect(result.lookbackDaysUsed).toBe(WIDGET_STREAK_MAX_LOOKBACK_DAYS);
    expect(result.streak.complete).toBe(false); // never silently promoted to "exact"
    expect(result.streak.current).toBeGreaterThan(0); // still a real, if partial, lower-bound count
  });

  it('a flexible schedule also benefits from incremental lookback (week-granularity floor)', async () => {
    const fetchRange: CompletedWorkoutActivityDatesFetcher = vi.fn(async (_uid, from, to) => {
      // 2 completions every week, unbroken, starting 2026-01-01.
      const unbroken = unbrokenCompletionsFetcher();
      const { performedDates } = await unbroken('u1', from < '2026-01-01' ? '2026-01-01' : from, to);
      return { performedDates: performedDates.slice(0, Math.ceil(performedDates.length * (2 / 3))), scheduledDates: [] };
    });

    const result = await fetchWidgetStreakHistory({
      uid: 'u1',
      todayLocalDate: '2026-09-09',
      streakInput: { scheduleMode: 'flexible', prescribedTrainingFrequency: 2, trainingDays: [], activeRecoveryDays: [] },
      fetchRange,
    });

    expect(result.streak.scheduleMode).toBe('flexible');
    expect(result.streak.unit).toBe('weeks');
  });
});
