import { WEEKDAY_ORDER } from '../state/AppState';
import { addDaysLocal, weekdayOfLocalDate, type LocalDate } from '../scheduleEngine/calendar';

/**
 * "Sua frequência" (Home) — a binary, GitHub-inspired but not GitHub-shaped
 * projection of real completed dates only. Deliberately has no
 * adherence/rest-day semantics: a cell is either `completed` (a workout
 * happened that day) or not. Whether that day was even a scheduled training
 * day is a different question this view never answers, so a legitimate rest
 * day never reads as a failure.
 */
export const FREQUENCY_WINDOW_DAYS = 30;

export interface FrequencyDayCell {
  localDate: LocalDate;
  completed: boolean;
  isToday: boolean;
}

/** `GRID_COLUMNS` columns, Monday-first (matches `WEEKDAY_ORDER`/`WeeklyOverview`) — `null` cells are pure alignment filler with no date/meaning. */
export const GRID_COLUMNS = 7;

/**
 * Fixed row count for every window, regardless of which weekday it starts
 * on (leading padding ranges 0..GRID_COLUMNS-1). Worst case is the maximum
 * possible leading pad plus the full 30-day window. Keeping this constant —
 * rather than `Math.ceil` on the actual cell count, which varies 5..6 rows
 * — means the section's rendered height never changes between windows, so
 * navigating never resizes the surrounding ScrollView's content and never
 * causes it to clamp/jump the scroll offset.
 */
export const GRID_ROWS = Math.ceil((GRID_COLUMNS - 1 + FREQUENCY_WINDOW_DAYS) / GRID_COLUMNS);

export interface FrequencyWindowViewModel {
  /** Chronological, oldest first — always exactly `FREQUENCY_WINDOW_DAYS` entries. */
  days: FrequencyDayCell[];
  /** `days` laid out into `GRID_COLUMNS`-wide rows, padded with `null` so every date sits under its correct Monday-first weekday column. */
  weeks: (FrequencyDayCell | null)[][];
  startLocalDate: LocalDate;
  endLocalDate: LocalDate;
  completedCount: number;
  /** `offsetWindows` this view was built for — 0 is the window ending today. */
  offsetWindows: number;
  /** True when `endLocalDate` is `todayLocalDate` — the "next" control must be disabled/hidden here. */
  isCurrentWindow: boolean;
}

/**
 * Start/end local dates of consecutive, non-overlapping 30-day blocks
 * counting back from today. `offsetWindows` 0 is `[today - 29, today]`; 1 is
 * the 30 days immediately before that; etc. Never accepts a negative offset —
 * the caller (navigation state) is responsible for refusing to request a
 * future window.
 */
export function frequencyWindowBounds(
  todayLocalDate: LocalDate,
  offsetWindows: number,
): { startLocalDate: LocalDate; endLocalDate: LocalDate } {
  if (!Number.isInteger(offsetWindows) || offsetWindows < 0) {
    throw new Error(`INVALID_FREQUENCY_WINDOW_OFFSET:${offsetWindows}`);
  }
  const endLocalDate = addDaysLocal(todayLocalDate, -FREQUENCY_WINDOW_DAYS * offsetWindows);
  const startLocalDate = addDaysLocal(endLocalDate, -(FREQUENCY_WINDOW_DAYS - 1));
  return { startLocalDate, endLocalDate };
}

export function buildFrequencyWindow(input: {
  todayLocalDate: LocalDate;
  offsetWindows: number;
  completedDates: ReadonlySet<LocalDate>;
}): FrequencyWindowViewModel {
  const { startLocalDate, endLocalDate } = frequencyWindowBounds(input.todayLocalDate, input.offsetWindows);

  const days: FrequencyDayCell[] = [];
  let completedCount = 0;
  for (let i = 0; i < FREQUENCY_WINDOW_DAYS; i += 1) {
    const localDate = addDaysLocal(startLocalDate, i);
    const completed = input.completedDates.has(localDate);
    if (completed) completedCount += 1;
    days.push({ localDate, completed, isToday: localDate === input.todayLocalDate });
  }

  const leadingPad = WEEKDAY_ORDER.indexOf(weekdayOfLocalDate(startLocalDate));
  const cells: (FrequencyDayCell | null)[] = Array.from({ length: GRID_ROWS * GRID_COLUMNS }, (_, i) => {
    const dayIndex = i - leadingPad;
    return dayIndex >= 0 && dayIndex < days.length ? days[dayIndex] : null;
  });
  const weeks: (FrequencyDayCell | null)[][] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    weeks.push(cells.slice(row * GRID_COLUMNS, row * GRID_COLUMNS + GRID_COLUMNS));
  }

  return {
    days,
    weeks,
    startLocalDate,
    endLocalDate,
    completedCount,
    offsetWindows: input.offsetWindows,
    isCurrentWindow: input.offsetWindows === 0,
  };
}

/**
 * Monotonic merge of a newly-resolved fetch's requested lower bound into
 * `useFrequencyWindow`'s "covered from" cache marker — only ever moves
 * backward/older, never forward. With two windows navigated to in quick
 * succession (e.g. Jul then Jun), the deeper request (Jun) can resolve
 * *before* the shallower one (Jul) depending on network timing. If the
 * shallower request were allowed to blindly overwrite the marker on
 * resolution, coverage would regress from Jun back to Jul even though the
 * completed-dates cache already has everything back through Jun —
 * corrupting the cache's own bookkeeping (a real request race).
 */
export function mergeCoveredFrom(current: LocalDate | null, requestedFrom: LocalDate): LocalDate {
  return current === null || requestedFrom < current ? requestedFrom : current;
}
