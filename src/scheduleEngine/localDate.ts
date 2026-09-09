import type { LocalDate } from './calendar';

export interface LocalDateTimeParts {
  localDate: LocalDate;
  hour: number;
  minute: number;
}

const LOCAL_DATE_TIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = LOCAL_DATE_TIME_FORMATTERS.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  LOCAL_DATE_TIME_FORMATTERS.set(timezone, formatter);
  return formatter;
}

/** Accepts named IANA zones (plus UTC) and rejects fixed-offset strings. */
export function canonicalIanaTimezone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null;
  if (/^[+-]\d{2}:?\d{2}$/.test(value)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function localDateTimeInTimezone(instant: Date, timezone: string): LocalDateTimeParts {
  const values = Object.fromEntries(
    formatterFor(timezone).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    localDate: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

/**
 * Local calendar date for a timezone, independent of the device's own
 * timezone or UTC (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md §Timezone).
 * `en-CA` is a locale trick — it's the built-in Intl format that already
 * emits `YYYY-MM-DD`, so no manual token assembly/timezone-offset math.
 */
export function localDateInTimezone(instant: Date, timezone: string): LocalDate {
  return localDateTimeInTimezone(instant, timezone).localDate;
}
