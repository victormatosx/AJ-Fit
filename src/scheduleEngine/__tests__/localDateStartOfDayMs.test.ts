import { describe, expect, it } from 'vitest';
import { localDateInTimezone, localDateStartOfDayMs } from '../localDate';

/** Round-trips the computed instant back through the SAME local-date resolver the rest of the domain uses, and asserts it reads exactly 00:00 of the target date — the actual contract native code will rely on. */
function assertMidnight(localDate: string, timezone: string) {
  const ms = localDateStartOfDayMs(localDate, timezone);
  expect(localDateInTimezone(new Date(ms), timezone)).toBe(localDate);
  const oneMinuteEarlier = new Date(ms - 60_000);
  expect(localDateInTimezone(oneMinuteEarlier, timezone)).not.toBe(localDate);
}

describe('localDateStartOfDayMs', () => {
  it('UTC: midnight is the naive Date.UTC value', () => {
    expect(localDateStartOfDayMs('2026-10-01', 'UTC')).toBe(Date.UTC(2026, 9, 1, 0, 0, 0));
    assertMidnight('2026-10-01', 'UTC');
  });

  it('fixed negative offset, no DST (America/Sao_Paulo, UTC-3 since 2019)', () => {
    const ms = localDateStartOfDayMs('2026-10-01', 'America/Sao_Paulo');
    expect(ms).toBe(Date.UTC(2026, 9, 1, 3, 0, 0)); // 00:00 BRT == 03:00 UTC
    assertMidnight('2026-10-01', 'America/Sao_Paulo');
  });

  it('fixed positive offset, no DST (Asia/Tokyo, UTC+9)', () => {
    const ms = localDateStartOfDayMs('2026-10-01', 'Asia/Tokyo');
    expect(ms).toBe(Date.UTC(2026, 8, 30, 15, 0, 0)); // 00:00 JST == previous-day 15:00 UTC
    assertMidnight('2026-10-01', 'Asia/Tokyo');
  });

  it('DST zone, standard-time date (America/New_York, EST = UTC-5)', () => {
    assertMidnight('2026-01-15', 'America/New_York');
    expect(localDateStartOfDayMs('2026-01-15', 'America/New_York')).toBe(Date.UTC(2026, 0, 15, 5, 0, 0));
  });

  it('DST zone, daylight-time date (America/New_York, EDT = UTC-4)', () => {
    assertMidnight('2026-07-15', 'America/New_York');
    expect(localDateStartOfDayMs('2026-07-15', 'America/New_York')).toBe(Date.UTC(2026, 6, 15, 4, 0, 0));
  });

  it('the exact day DST "springs forward" in the US (2026-03-08) still resolves to a real local midnight', () => {
    // 2026-03-08 02:00 EST jumps to 03:00 EDT — 00:00 that day is still
    // unambiguous (before the jump) and must round-trip exactly.
    assertMidnight('2026-03-08', 'America/New_York');
  });

  it('the exact day DST "falls back" in the US (2026-11-01) still resolves to a real local midnight', () => {
    assertMidnight('2026-11-01', 'America/New_York');
  });

  it('a southern-hemisphere DST transition (Australia/Sydney) still round-trips', () => {
    assertMidnight('2026-04-05', 'Australia/Sydney'); // AEDT -> AEST transition date
    assertMidnight('2026-10-04', 'Australia/Sydney'); // AEST -> AEDT transition date
  });

  it('year rollover (2026-12-31 -> 2027-01-01) is plain date math under any zone', () => {
    const dec31 = localDateStartOfDayMs('2026-12-31', 'America/Sao_Paulo');
    const jan1 = localDateStartOfDayMs('2027-01-01', 'America/Sao_Paulo');
    expect(jan1 - dec31).toBe(24 * 60 * 60 * 1000);
    assertMidnight('2026-12-31', 'America/Sao_Paulo');
    assertMidnight('2027-01-01', 'America/Sao_Paulo');
  });
});
