import { describe, expect, it } from 'vitest';

import { resolveWorkoutSchedule, detectMissedSessionGap } from '../resolver';
import { localDateInTimezone } from '../localDate';
import type { ScheduleConfig } from '../types';

/**
 * Audit hardening (audit §2 — timezone/midnight): behavioral coverage for
 * how "today" is resolved around local midnight, across differing
 * timezones, and across a timezone change — composed with the real
 * `resolveWorkoutSchedule`/`detectMissedSessionGap`, not a reimplementation.
 * `resolver.test.ts` already has one smoke test proving the resolver never
 * reasons about UTC instants; these add the specific scenarios the audit
 * asked for.
 */
describe('resolveWorkoutSchedule composed with real local-date resolution — midnight boundary', () => {
  it('23:50 local (already the next UTC calendar day) still resolves "today" as the local date, not the UTC one', () => {
    // 2026-09-07 23:50 America/Sao_Paulo (UTC-3, no DST) == 2026-09-08 02:50 UTC.
    const instant = new Date('2026-09-08T02:50:00.000Z');
    const localToday = localDateInTimezone(instant, 'America/Sao_Paulo');
    expect(localToday).toBe('2026-09-07'); // Monday
    // Pin the failure mode this guards against: naive `toISOString().slice(0, 10)`
    // UTC-slicing would have rolled the date early.
    expect(instant.toISOString().slice(0, 10)).toBe('2026-09-08');

    const config: ScheduleConfig = { trainingDays: ['MON'], timezone: 'America/Sao_Paulo', scheduleVersion: 1 };
    const resolution = resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: 1,
      config,
      state: null,
      activatedAtLocalDate: localToday,
      todayLocalDate: localToday,
    });
    expect(resolution).toEqual({ status: 'SESSION_READY', sessionIndex: 0 });
  });

  it('00:10 local (just after local midnight) already rolls to the new local date, even while the previous UTC day has not yet ended in a positive-offset zone', () => {
    // 2026-09-08 00:10 Asia/Tokyo (UTC+9) == 2026-09-07 15:10 UTC — the UTC
    // calendar day is still the 7th, but the local day is already the 8th.
    const instant = new Date('2026-09-07T15:10:00.000Z');
    const localToday = localDateInTimezone(instant, 'Asia/Tokyo');
    expect(localToday).toBe('2026-09-08'); // Tuesday
    expect(instant.toISOString().slice(0, 10)).toBe('2026-09-07');

    const config: ScheduleConfig = { trainingDays: ['TUE'], timezone: 'Asia/Tokyo', scheduleVersion: 1 };
    const resolution = resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: 1,
      config,
      state: null,
      activatedAtLocalDate: localToday,
      todayLocalDate: localToday,
    });
    expect(resolution).toEqual({ status: 'SESSION_READY', sessionIndex: 0 });
  });
});

describe('device timezone differs from the configured schedule timezone', () => {
  it('only the configured schedule timezone decides "today" — a divergent device timezone would disagree and must never be consulted', () => {
    // 2026-09-07 22:00 America/Sao_Paulo (UTC-3) == 2026-09-08 01:00 UTC ==
    // 2026-09-08 10:00 Asia/Tokyo (UTC+9). The SAME instant is Monday in the
    // schedule's configured timezone and already Tuesday in a hypothetical
    // device timezone — a real traveling user, or a device clock set to a
    // different region than the schedule's own `timezone`.
    const instant = new Date('2026-09-08T01:00:00.000Z');
    const configuredToday = localDateInTimezone(instant, 'America/Sao_Paulo');
    const deviceToday = localDateInTimezone(instant, 'Asia/Tokyo');
    expect(configuredToday).toBe('2026-09-07'); // Monday
    expect(deviceToday).toBe('2026-09-08'); // Tuesday
    expect(configuredToday).not.toBe(deviceToday);

    const config: ScheduleConfig = { trainingDays: ['MON'], timezone: 'America/Sao_Paulo', scheduleVersion: 1 };

    // Resolving with the CONFIGURED timezone's date: Monday is a trainingDay.
    const withConfiguredTimezone = resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: 1,
      config,
      state: null,
      activatedAtLocalDate: configuredToday,
      todayLocalDate: configuredToday,
    });
    expect(withConfiguredTimezone.status).toBe('SESSION_READY');

    // Had the device's own timezone been used instead (the bug this proves
    // is absent), Tuesday is NOT a trainingDay and the user would have been
    // wrongly told there is nothing to train today.
    const withDeviceTimezone = resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: 1,
      config,
      state: null,
      activatedAtLocalDate: deviceToday,
      todayLocalDate: deviceToday,
    });
    expect(withDeviceTimezone.status).toBe('REST_DAY');
  });
});

describe('timezone changed between a persisted ScheduleState and the next resolve', () => {
  it('the resolver never reads config.timezone — persisted cursorDate/nextSessionIndex are immune to a later timezone edit', () => {
    // A completion persisted while scheduleConfig.timezone was
    // 'America/Sao_Paulo'; the user then edits their schedule timezone to
    // 'Asia/Tokyo' (`saveScheduleConfig`) before the next resolve. The
    // cursor/index are opaque date strings/integers — a later timezone edit
    // must not re-walk or reinterpret them under the new zone.
    const state = {
      nextSessionIndex: 1,
      cursorDate: '2026-09-07', // Monday, already consumed
      lastCompletedAt: '2026-09-07',
      pendingMissDecision: null,
    };
    const trainingDays = ['MON', 'WED', 'FRI'] as const;
    const configBeforeEdit: ScheduleConfig = { trainingDays: [...trainingDays], timezone: 'America/Sao_Paulo', scheduleVersion: 1 };
    const configAfterEdit: ScheduleConfig = { trainingDays: [...trainingDays], timezone: 'Asia/Tokyo', scheduleVersion: 1 };

    // Next trainingDay strictly after the cursor (Monday) is Wednesday 2026-09-09.
    const todayLocalDate = '2026-09-09';
    const before = resolveWorkoutSchedule({
      hasActiveProgram: true, sessionCount: 3, config: configBeforeEdit, state, activatedAtLocalDate: '2026-09-01', todayLocalDate,
    });
    const after = resolveWorkoutSchedule({
      hasActiveProgram: true, sessionCount: 3, config: configAfterEdit, state, activatedAtLocalDate: '2026-09-01', todayLocalDate,
    });
    // Byte-identical: only `trainingDays`/`scheduleMode` participate in the
    // walk — `timezone` is inert to this pure function by construction.
    expect(after).toEqual(before);
    expect(after).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
  });
});

describe('a missed-session gap spanning a week boundary (Friday -> weekend -> Monday)', () => {
  it('detects the exact gap across Sat/Sun with no special-cased week boundary, anchored at the first missed trainingDay (Monday)', () => {
    const config: ScheduleConfig = { trainingDays: ['MON', 'FRI'], timezone: 'UTC', scheduleVersion: 1 };
    // Last completion: Friday 2026-08-28. Next two trainingDays after it are
    // Monday 2026-08-31 and Friday 2026-09-04; today is the Monday AFTER
    // that (2026-09-07) — two full trainingDays elapsed without completion,
    // crossing two weekends.
    const state = {
      nextSessionIndex: 1,
      cursorDate: '2026-08-28',
      lastCompletedAt: '2026-08-28',
      pendingMissDecision: null,
    };
    const gap = detectMissedSessionGap({
      hasActiveProgram: true, sessionCount: 2, config, state, activatedAtLocalDate: '2026-08-24', todayLocalDate: '2026-09-07',
    });
    expect(gap).toEqual({
      missedSessionIndex: 1,
      calendarSessionIndex: 1, // (1 + missedCount=2) % 2 == 1 — wraps back onto the same index
      missedScheduledDate: '2026-08-31', // the Monday right after the Friday cursor, not a later date
    });

    const resolution = resolveWorkoutSchedule({
      hasActiveProgram: true, sessionCount: 2, config, state, activatedAtLocalDate: '2026-08-24', todayLocalDate: '2026-09-07',
    });
    expect(resolution).toEqual({
      status: 'MISSED_SESSION_DECISION_REQUIRED',
      missedSessionIndex: 1,
      calendarSessionIndex: 1,
      missedScheduledDate: '2026-08-31',
    });
  });

  it('Sunday today, with yesterday (Saturday) never a trainingDay: a lone Friday session still pending is REST_DAY, not a gap yet', () => {
    // Only one trainingDay occurrence (Friday) has elapsed since the cursor —
    // not yet a 2nd occurrence, so there is nothing to ask about (docs
    // §Detecção de miss) even though two calendar days (Sat, Sun) passed.
    const config: ScheduleConfig = { trainingDays: ['FRI'], timezone: 'UTC', scheduleVersion: 1 };
    const state = {
      nextSessionIndex: 0,
      cursorDate: '2026-08-21', // Friday, already consumed
      lastCompletedAt: '2026-08-21',
      pendingMissDecision: null,
    };
    const resolution = resolveWorkoutSchedule({
      hasActiveProgram: true, sessionCount: 1, config, state, activatedAtLocalDate: '2026-08-21', todayLocalDate: '2026-08-23', // Sunday
    });
    expect(resolution.status).toBe('REST_DAY');
    expect(detectMissedSessionGap({
      hasActiveProgram: true, sessionCount: 1, config, state, activatedAtLocalDate: '2026-08-21', todayLocalDate: '2026-08-23',
    })).toBeNull();
  });
});
