import { isSameCalendarDay } from './dateUtils';

/**
 * Presentation-only bucketing of a real last-sign-in timestamp (Firebase
 * Auth `user.metadata.lastSignInTime`) into "today" / "yesterday" / a dated
 * label — mirrors how the rest of the app buckets relative dates, but keeps
 * this pure so the security screen can stay a thin consumer. Never invents
 * a timestamp: callers must only call this with a real, parsed `Date`.
 */
export type LastSignInDescription =
  | { kind: 'today'; time: string }
  | { kind: 'yesterday'; time: string }
  | { kind: 'other'; date: string; time: string };

export function describeLastSignIn(
  signInDate: Date,
  locale: string,
  now: Date = new Date(),
): LastSignInDescription {
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(signInDate);

  if (isSameCalendarDay(signInDate, now)) {
    return { kind: 'today', time };
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameCalendarDay(signInDate, yesterday)) {
    return { kind: 'yesterday', time };
  }

  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
  }).format(signInDate);
  return { kind: 'other', date, time };
}

/**
 * Parses Firebase Auth's `user.metadata.lastSignInTime` (a UTC date string,
 * or `undefined`/unparseable on some providers/environments). Returns
 * `null` rather than a fabricated date when the field is missing or
 * malformed — the caller must treat `null` as "no reliable source" and omit
 * the UI row entirely.
 */
export function parseLastSignInTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
