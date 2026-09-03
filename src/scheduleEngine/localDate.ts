import type { LocalDate } from './calendar';

/**
 * Local calendar date for a timezone, independent of the device's own
 * timezone or UTC (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md §Timezone).
 * `en-CA` is a locale trick — it's the built-in Intl format that already
 * emits `YYYY-MM-DD`, so no manual token assembly/timezone-offset math.
 */
export function localDateInTimezone(instant: Date, timezone: string): LocalDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
