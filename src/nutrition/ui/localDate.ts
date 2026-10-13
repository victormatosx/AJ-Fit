/**
 * The diary works in the device's LOCAL calendar day, never UTC (round
 * brief part 1 — "O diário deve funcionar por data local do usuário, não
 * UTC puro"). `Date`'s local getters (not `toISOString`, which is UTC) are
 * the whole trick — no date library needed for this.
 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayLocalDate(now: Date = new Date()): string {
  return toLocalDateString(now);
}

export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
  catch { return 'UTC'; }
}

/** `addDays(-1)`/`addDays(1)` for the diary's prev/next navigation — stays in local time throughout. */
export function shiftLocalDate(localDate: string, deltaDays: number): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const shifted = new Date(year, month - 1, day);
  shifted.setDate(shifted.getDate() + deltaDays);
  return toLocalDateString(shifted);
}

/** Monday-first week used throughout Nutrition's diary and weekly summary. */
export function startOfLocalWeek(value: Date | string = new Date()): string {
  const date = typeof value === 'string'
    ? (() => {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year, month - 1, day);
    })()
    : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  return toLocalDateString(date);
}

export function localWeekDates(weekStartLocalDate: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftLocalDate(weekStartLocalDate, index));
}

export function endOfLocalWeek(value: Date | string = new Date()): string {
  return shiftLocalDate(startOfLocalWeek(value), 6);
}

/** Blocks accidental logging into a date that hasn't happened yet (round brief §10). */
export function isFutureLocalDate(localDate: string, now: Date = new Date()): boolean {
  return localDate > todayLocalDate(now);
}
