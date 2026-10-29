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

/**
 * THE timezone a progression evaluation runs in.
 *
 * Client and authority must resolve the same one or they disagree about what
 * "today" is, which shifts `countedDates` by a day, shifts a week's target by
 * one, and used to make the EARN authority reject the client's figures. The
 * client used to fall back to the DEVICE timezone here while the authority
 * fell back to `'UTC'`, so any account whose `scheduleConfig.timezone` was
 * missing or malformed was evaluated against two different calendars.
 *
 * `'UTC'` is the single fallback, chosen because it is what the authority
 * already used: this moves the client ONTO the authority's answer and never
 * the reverse, so no account's authoritative evaluation changes.
 */
export const PROGRESSION_FALLBACK_TIMEZONE = 'UTC';

export function progressionTimezone(configuredTimezone: unknown): string {
  return canonicalIanaTimezone(configuredTimezone) ?? PROGRESSION_FALLBACK_TIMEZONE;
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

/** UTC-labeled reinterpretation of `instant`'s own wall-clock reading in `timezone`, minus `instant` itself — i.e. that zone's real UTC offset (ms) at `instant`, positive east of UTC. Internal to `localDateStartOfDayMs`. */
function utcOffsetMsAt(instantMs: number, timezone: string): number {
  const parts = localDateTimeInTimezone(new Date(instantMs), timezone);
  const [year, month, day] = parts.localDate.split('-').map(Number);
  const renderedAsUtcMs = Date.UTC(year, month - 1, day, parts.hour, parts.minute, 0);
  return renderedAsUtcMs - instantMs;
}

/**
 * UTC epoch ms of local midnight (00:00:00.000) for `localDate` in
 * `timezone` — the instant a native `TimelineEntry`/Glance update can
 * compare `now >= effectiveAtMs` against without ever computing a weekday
 * or calendar date itself (see Phase 2.5 report §Timezone/DST).
 *
 * Two-pass convergence, the same approach `date-fns-tz`'s
 * `zonedTimeToUtc`/Luxon's zone math use under the hood: guess the offset
 * using the NAIVE (target-labeled-as-UTC) instant, correct once, then
 * recompute the offset at the CORRECTED instant and correct again. One
 * pass is exact everywhere except within a DST transition's own offset
 * window (at most a couple of hours); the second pass, now evaluating the
 * offset at a candidate already inside the right side of the transition,
 * converges exactly. No timezone library dependency — same `Intl`-only
 * approach `localDateInTimezone` already uses.
 */
export function localDateStartOfDayMs(localDate: LocalDate, timezone: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  const naiveTargetMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstPassMs = naiveTargetMs - utcOffsetMsAt(naiveTargetMs, timezone);
  return naiveTargetMs - utcOffsetMsAt(firstPassMs, timezone);
}
