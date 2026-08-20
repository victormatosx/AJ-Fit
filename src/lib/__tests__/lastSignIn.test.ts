import { describe, expect, it } from 'vitest';
import { describeLastSignIn, parseLastSignInTime } from '../lastSignIn';

describe('parseLastSignInTime', () => {
  it('parses a real Firebase metadata.lastSignInTime string', () => {
    const parsed = parseLastSignInTime('Tue, 20 Aug 2026 09:42:00 GMT');
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.toISOString()).toBe('2026-08-20T09:42:00.000Z');
  });

  it('returns null rather than inventing a date when the field is missing', () => {
    expect(parseLastSignInTime(undefined)).toBeNull();
    expect(parseLastSignInTime(null)).toBeNull();
    expect(parseLastSignInTime('')).toBeNull();
  });

  it('returns null for an unparseable value instead of a fabricated fallback', () => {
    expect(parseLastSignInTime('not-a-date')).toBeNull();
  });
});

describe('describeLastSignIn', () => {
  const now = new Date('2026-08-20T18:00:00Z');

  it('buckets a same-calendar-day sign-in as "today"', () => {
    const result = describeLastSignIn(new Date('2026-08-20T09:42:00Z'), 'en-US', now);
    expect(result.kind).toBe('today');
  });

  it('buckets the previous calendar day as "yesterday"', () => {
    const result = describeLastSignIn(new Date('2026-08-19T18:20:00Z'), 'en-US', now);
    expect(result.kind).toBe('yesterday');
  });

  it('buckets anything older as a dated label', () => {
    const result = describeLastSignIn(new Date('2026-08-10T14:32:00Z'), 'en-US', now);
    expect(result.kind).toBe('other');
    if (result.kind === 'other') {
      expect(result.date).toBeTruthy();
    }
  });

  it('formats the time using the given locale (not a hardcoded language)', () => {
    const ptResult = describeLastSignIn(new Date('2026-08-20T09:42:00Z'), 'pt-BR', now);
    const enResult = describeLastSignIn(new Date('2026-08-20T09:42:00Z'), 'en-US', now);
    expect(ptResult.time).not.toEqual(enResult.time);
  });

  it('never crosses a calendar-day boundary based on wall-clock assumptions', () => {
    // Local calendar dates, not UTC instants — a sign-in at 23:58 the day
    // before `now`'s calendar date must read as "yesterday" even though
    // only minutes elapsed, and must never flip to "today" due to a UTC/
    // local timezone mismatch.
    const lateNight = new Date(2026, 7, 19, 23, 58, 0);
    const nowJustAfterMidnight = new Date(2026, 7, 20, 0, 2, 0);
    const result = describeLastSignIn(lateNight, 'en-US', nowJustAfterMidnight);
    expect(result.kind).toBe('yesterday');
  });
});
