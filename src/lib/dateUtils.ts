/** Small, pure date helpers shared by the assessment screen/modals. */

const MONTHS_PT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/**
 * Builds a real calendar date from day/month/year parts, or null when the
 * combination doesn't exist (e.g. 30/02/2026). `Date` silently rolls invalid
 * day-of-month values into the next month, so we round-trip the constructed
 * date and reject it if the parts don't match back exactly.
 */
export function parseDateParts(day: number, month: number, year: number): Date | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (month < 1 || month > 12 || day < 1 || year < 1900) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isFutureDate(d: Date): boolean {
  return d.getTime() > Date.now();
}

export function formatDatePt(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  return `${day} ${MONTHS_PT[d.getMonth()]} ${d.getFullYear()}`;
}

/** Compact "DD/MM" label — used for chart axis endpoints, where space is tight. */
export function formatShortDatePt(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}
