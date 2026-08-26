import { WEEKDAY_ORDER, type Weekday } from '../state/AppState';

/** Local calendar date, always `YYYY-MM-DD` — never a UTC instant (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md §Timezone). */
export type LocalDate = string;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertLocalDate(value: LocalDate): void {
  if (!LOCAL_DATE_PATTERN.test(value)) throw new Error(`INVALID_LOCAL_DATE:${value}`);
}

function toUtcMidnight(value: LocalDate): number {
  assertLocalDate(value);
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMidnight(ms: number): LocalDate {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function addDaysLocal(value: LocalDate, days: number): LocalDate {
  return fromUtcMidnight(toUtcMidnight(value) + days * MS_PER_DAY);
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  assertLocalDate(a);
  assertLocalDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `Date#getUTCDay()` is Sunday-first (0-6); `WEEKDAY_ORDER` is Monday-first. */
const JS_DAY_TO_WEEKDAY: readonly Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function weekdayOfLocalDate(value: LocalDate): Weekday {
  const jsDay = new Date(toUtcMidnight(value)).getUTCDay();
  return JS_DAY_TO_WEEKDAY[jsDay];
}

/** Safety cap — no legitimate call walks more than a year of missed days. */
const MAX_WALK_DAYS = 366;

/**
 * Every trainingDay strictly after `fromDateExclusive` up to and including
 * `toDateInclusive`, in chronological order. Used both to detect "today is a
 * plain trainingDay" (exactly one occurrence) and "N sessions were missed"
 * (more than one) — see resolver.ts.
 */
export function trainingDayOccurrences(
  trainingDays: readonly Weekday[],
  fromDateExclusive: LocalDate,
  toDateInclusive: LocalDate,
): LocalDate[] {
  if (compareLocalDates(fromDateExclusive, toDateInclusive) >= 0) return [];
  const allowed = new Set(trainingDays);
  const occurrences: LocalDate[] = [];
  let cursor = addDaysLocal(fromDateExclusive, 1);
  let guard = 0;
  while (compareLocalDates(cursor, toDateInclusive) <= 0 && guard < MAX_WALK_DAYS) {
    if (allowed.has(weekdayOfLocalDate(cursor))) occurrences.push(cursor);
    cursor = addDaysLocal(cursor, 1);
    guard += 1;
  }
  return occurrences;
}

export function normalizeWeekdayOrder(days: readonly Weekday[]): Weekday[] {
  const set = new Set(days);
  return WEEKDAY_ORDER.filter((day) => set.has(day));
}
