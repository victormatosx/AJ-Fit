import { describe, expect, it } from 'vitest';
import {
  buildFrequencyWindow,
  frequencyWindowNeedsPromotion,
  frequencyWindowBounds,
  mergeCoveredFrom,
  FREQUENCY_WINDOW_DAYS,
  GRID_COLUMNS,
  GRID_ROWS,
} from '../frequencyHeatmap';

describe('frequencyWindowBounds / buildFrequencyWindow', () => {
  it('the current window (offset 0) has exactly 30 days ending today', () => {
    const window = buildFrequencyWindow({
      todayLocalDate: '2026-09-07',
      offsetWindows: 0,
      completedDates: new Set(),
    });
    expect(window.days).toHaveLength(FREQUENCY_WINDOW_DAYS);
    expect(window.startLocalDate).toBe('2026-08-09');
    expect(window.endLocalDate).toBe('2026-09-07');
  });

  it('today is the last date of the current window', () => {
    const window = buildFrequencyWindow({
      todayLocalDate: '2026-09-07',
      offsetWindows: 0,
      completedDates: new Set(),
    });
    expect(window.days[window.days.length - 1].localDate).toBe('2026-09-07');
    expect(window.days[window.days.length - 1].isToday).toBe(true);
    expect(window.days.filter((d) => d.isToday)).toHaveLength(1);
  });

  it('the previous window (offset 1) is exactly the 30 days immediately before the current one, no gap/no overlap', () => {
    const current = buildFrequencyWindow({ todayLocalDate: '2026-09-07', offsetWindows: 0, completedDates: new Set() });
    const previous = buildFrequencyWindow({ todayLocalDate: '2026-09-07', offsetWindows: 1, completedDates: new Set() });
    expect(previous.endLocalDate).toBe('2026-08-08');
    expect(previous.startLocalDate).toBe('2026-07-10');
    // No gap: previous.end + 1 day === current.start.
    const dayAfterPreviousEnd = new Date(`${previous.endLocalDate}T12:00:00`);
    dayAfterPreviousEnd.setDate(dayAfterPreviousEnd.getDate() + 1);
    const dayAfterPreviousEndIso = dayAfterPreviousEnd.toISOString().slice(0, 10);
    expect(dayAfterPreviousEndIso).toBe(current.startLocalDate);
    // No overlap: no date appears in both windows.
    const currentDates = new Set(current.days.map((d) => d.localDate));
    const overlap = previous.days.filter((d) => currentDates.has(d.localDate));
    expect(overlap).toHaveLength(0);
  });

  it('going back multiple windows produces consecutive, non-overlapping 30-day blocks', () => {
    const windows = [0, 1, 2, 3].map((offset) =>
      buildFrequencyWindow({ todayLocalDate: '2026-09-07', offsetWindows: offset, completedDates: new Set() }),
    );
    const allDates = windows.flatMap((w) => w.days.map((d) => d.localDate));
    expect(new Set(allDates).size).toBe(allDates.length); // no duplicates across windows
    for (let i = 0; i < windows.length - 1; i += 1) {
      expect(windows[i].startLocalDate > windows[i + 1].endLocalDate).toBe(true);
    }
  });

  it('never accepts a negative offset (never a future window)', () => {
    expect(() => frequencyWindowBounds('2026-09-07', -1)).toThrow();
    expect(() => buildFrequencyWindow({ todayLocalDate: '2026-09-07', offsetWindows: -1, completedDates: new Set() })).toThrow();
  });

  it('isCurrentWindow is true only for offset 0', () => {
    const current = buildFrequencyWindow({ todayLocalDate: '2026-09-07', offsetWindows: 0, completedDates: new Set() });
    const previous = buildFrequencyWindow({ todayLocalDate: '2026-09-07', offsetWindows: 1, completedDates: new Set() });
    expect(current.isCurrentWindow).toBe(true);
    expect(previous.isCurrentWindow).toBe(false);
  });

  it('spans a month boundary correctly', () => {
    const window = buildFrequencyWindow({ todayLocalDate: '2026-10-03', offsetWindows: 0, completedDates: new Set() });
    expect(window.startLocalDate.startsWith('2026-09')).toBe(true);
    expect(window.endLocalDate).toBe('2026-10-03');
    expect(window.days).toHaveLength(30);
  });

  it('spans a year boundary correctly', () => {
    const window = buildFrequencyWindow({ todayLocalDate: '2027-01-05', offsetWindows: 0, completedDates: new Set() });
    expect(window.startLocalDate.startsWith('2026-12')).toBe(true);
    expect(window.endLocalDate).toBe('2027-01-05');
    expect(window.days).toHaveLength(30);
  });

  it('spans February in a leap year correctly', () => {
    // 2028 is a leap year; a window ending 2028-03-10 crosses Feb 29.
    const window = buildFrequencyWindow({ todayLocalDate: '2028-03-10', offsetWindows: 0, completedDates: new Set() });
    expect(window.days.some((d) => d.localDate === '2028-02-29')).toBe(true);
    expect(window.days).toHaveLength(30);
  });

  it('zero completed workouts still returns a full 30-day grid with zero count', () => {
    const window = buildFrequencyWindow({ todayLocalDate: '2026-09-07', offsetWindows: 0, completedDates: new Set() });
    expect(window.completedCount).toBe(0);
    expect(window.days.every((d) => !d.completed)).toBe(true);
  });

  it('counts each completed date exactly once, ignoring duplicates in the input set', () => {
    const window = buildFrequencyWindow({
      todayLocalDate: '2026-09-07',
      offsetWindows: 0,
      completedDates: new Set(['2026-09-01', '2026-09-01', '2026-09-05']),
    });
    expect(window.completedCount).toBe(2);
  });

  it('a date outside the window is ignored even if present in completedDates', () => {
    const window = buildFrequencyWindow({
      todayLocalDate: '2026-09-07',
      offsetWindows: 0,
      completedDates: new Set(['2020-01-01']),
    });
    expect(window.completedCount).toBe(0);
  });

  describe('weeks (grid) layout', () => {
    it('every row has exactly GRID_COLUMNS cells, and padding cells are null', () => {
      const window = buildFrequencyWindow({ todayLocalDate: '2026-09-07', offsetWindows: 0, completedDates: new Set() });
      expect(window.weeks.every((row) => row.length === GRID_COLUMNS)).toBe(true);
      const flat = window.weeks.flat();
      const realDays = flat.filter((cell) => cell !== null);
      expect(realDays).toHaveLength(FREQUENCY_WINDOW_DAYS);
    });

    it('each real day sits under its correct Monday-first weekday column', () => {
      // 2026-08-09 (window start above) is a Sunday -> column index 6 (Mon=0..Sun=6).
      const window = buildFrequencyWindow({ todayLocalDate: '2026-09-07', offsetWindows: 0, completedDates: new Set() });
      const firstRow = window.weeks[0];
      expect(firstRow[6]?.localDate).toBe('2026-08-09');
      expect(firstRow.slice(0, 6).every((cell) => cell === null)).toBe(true);
    });

    it('never duplicates a date across two cells', () => {
      const window = buildFrequencyWindow({ todayLocalDate: '2026-09-07', offsetWindows: 0, completedDates: new Set() });
      const dates = window.weeks.flat().filter((c) => c !== null).map((c) => c!.localDate);
      expect(new Set(dates).size).toBe(dates.length);
    });

    it('always renders exactly GRID_ROWS rows, regardless of which weekday the window starts on — the section\'s height must never change between windows (a changing height clamps/jumps the surrounding ScrollView on navigation)', () => {
      // Sample every offset in [0, 6]: the 30-day window's start date cycles
      // through all 7 possible weekdays as offsetWindows increases.
      for (let offset = 0; offset <= 6; offset += 1) {
        const window = buildFrequencyWindow({ todayLocalDate: '2026-09-07', offsetWindows: offset, completedDates: new Set() });
        expect(window.weeks).toHaveLength(GRID_ROWS);
      }
    });
  });
});

// `useFrequencyWindow` itself can't be rendered in this repo's test suite —
// `vitest.config.mts` scopes Vitest to pure domain-logic `.test.ts` files in
// a plain Node environment (see that file's own comment: "zero React
// Native/Expo runtime involved"), with no jsdom/react-test-renderer/
// testing-library configured to mount a hook and observe its state
// transitions across renders. The two behaviors that actually fixed the
// reported "scroll to top on first visit to a period" bug — (1) the
// previous window staying displayed (never `null`) while a new one loads,
// and (2) the render-time (not effect-time) commit that keeps a cache HIT
// from ever showing a stale frame — are structural/render-timing properties
// that require an actual React render pass to verify, and were instead
// confirmed by tracing the code path (see `useFrequencyWindow.ts`'s module
// doc); they must be confirmed once more on-device.
//
// What IS pure, isolated logic — and exactly the piece implicated in the
// request-race requirement — is the cache's "covered from" merge, tested
// below.
describe('mergeCoveredFrom', () => {
  it('adopts the requested date when nothing is covered yet', () => {
    expect(mergeCoveredFrom(null, '2026-08-09')).toBe('2026-08-09');
  });

  it('extends coverage backward when the new request reaches further back', () => {
    expect(mergeCoveredFrom('2026-08-09', '2026-07-10')).toBe('2026-07-10');
  });

  it('never regresses coverage when a request for a shallower range resolves', () => {
    expect(mergeCoveredFrom('2026-07-10', '2026-08-09')).toBe('2026-07-10');
  });

  it('reproduces the exact reported race: a deep request resolving before a shallow one must not be undone by the shallow one resolving later', () => {
    // User taps: Sept(current) -> Aug -> Jun in quick succession. Aug's
    // fetch (shallower) is still in flight when Jun's fetch (deeper)
    // resolves first.
    let coveredFrom: string | null = '2026-08-09'; // covered from the initial Sept load
    coveredFrom = mergeCoveredFrom(coveredFrom, '2026-06-10'); // Jun's fetch resolves first
    expect(coveredFrom).toBe('2026-06-10');
    coveredFrom = mergeCoveredFrom(coveredFrom, '2026-07-10'); // Aug's fetch resolves after, requesting a shallower range
    expect(coveredFrom).toBe('2026-06-10'); // must NOT regress to '2026-07-10'
  });

  it('is idempotent for the same date resolving twice (duplicate/retried request)', () => {
    expect(mergeCoveredFrom('2026-07-10', '2026-07-10')).toBe('2026-07-10');
  });
});

describe('frequencyWindowNeedsPromotion', () => {
  it('rebuilds the current window when a completion reload replaces its date snapshot', () => {
    const previous = new Set<string>();
    const reloaded = new Set<string>(['2026-09-07']);
    expect(frequencyWindowNeedsPromotion({
      isCovered: true,
      displayedOffset: 0,
      selectedOffset: 0,
      displayedDates: previous,
      completedDates: reloaded,
    })).toBe(true);
  });

  it('does not promote uncovered data or rebuild an unchanged snapshot', () => {
    const dates = new Set<string>(['2026-09-07']);
    expect(frequencyWindowNeedsPromotion({
      isCovered: false,
      displayedOffset: 0,
      selectedOffset: 0,
      displayedDates: dates,
      completedDates: new Set(dates),
    })).toBe(false);
    expect(frequencyWindowNeedsPromotion({
      isCovered: true,
      displayedOffset: 0,
      selectedOffset: 0,
      displayedDates: dates,
      completedDates: dates,
    })).toBe(false);
  });
});
