import { describe, expect, it } from 'vitest';

import { prescribedSessionCount, resolveEffectiveCalendarAuthority } from '../calendarAuthority';

const fixedProgram = {
  scheduleMode: 'fixed',
  prescribedTrainingFrequency: 3,
  sessions: [{}, {}, {}],
  weeklySchedule: [
    { weekday: 'TUE', state: 'TRAINING' },
    { weekday: 'THU', state: 'TRAINING' },
    { weekday: 'SAT', state: 'TRAINING' },
    { weekday: 'SUN', state: 'ACTIVE_RECOVERY' },
  ],
};

describe('resolveEffectiveCalendarAuthority', () => {
  it('counts the actual sessions for rotation, independently of weekly frequency', () => {
    expect(prescribedSessionCount({ prescribedTrainingFrequency: 4, sessions: [{}, {}, {}, {}, {}] })).toBe(5);
  });
  it('uses a complete ScheduleConfig instead of the sealed weeklySchedule', () => {
    expect(resolveEffectiveCalendarAuthority({
      program: fixedProgram,
      scheduleConfig: { scheduleMode: 'fixed', trainingDays: ['MON', 'WED', 'FRI'], timezone: 'America/Sao_Paulo' },
    })).toEqual({
      scheduleMode: 'fixed',
      trainingDays: ['MON', 'WED', 'FRI'],
      activeRecoveryDays: ['SUN'],
      source: 'SCHEDULE_CONFIG',
    });
  });

  it.each([
    ['wrong length', ['MON', 'WED']],
    ['duplicates', ['MON', 'MON', 'FRI']],
    ['invalid weekday', ['MON', 'WED', 'NOPE']],
  ])('falls back to the program for an inconsistent config: %s', (_label, trainingDays) => {
    expect(resolveEffectiveCalendarAuthority({
      program: fixedProgram,
      scheduleConfig: { scheduleMode: 'fixed', trainingDays },
    })).toMatchObject({ source: 'PROGRAM', trainingDays: ['TUE', 'THU', 'SAT'] });
  });

  it('supports a legacy account without ScheduleConfig and then snapshot fallback', () => {
    expect(resolveEffectiveCalendarAuthority({ program: fixedProgram, scheduleConfig: null }))
      .toMatchObject({ source: 'PROGRAM', trainingDays: ['TUE', 'THU', 'SAT'] });
    expect(resolveEffectiveCalendarAuthority({
      program: { scheduleMode: 'fixed', prescribedTrainingFrequency: 3, sessions: [{}, {}, {}], weeklySchedule: [] },
      scheduleConfig: null,
      snapshotInputs: { trainingDays: ['MON', 'WED', 'FRI'] },
    })).toMatchObject({ source: 'SNAPSHOT', trainingDays: ['MON', 'WED', 'FRI'] });
  });

  it('does not confuse legacy A/B rotation size with weekday frequency', () => {
    expect(resolveEffectiveCalendarAuthority({
      program: { sessions: [{}, {}] },
      scheduleConfig: { trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] },
      snapshotInputs: { trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] },
    })).toMatchObject({ source: 'SCHEDULE_CONFIG', trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] });
  });

  it('accepts flexible only with no fixed weekdays and drops active recovery', () => {
    expect(resolveEffectiveCalendarAuthority({
      program: fixedProgram,
      scheduleConfig: { scheduleMode: 'flexible', trainingDays: [] },
    })).toEqual({ scheduleMode: 'flexible', trainingDays: [], activeRecoveryDays: [], source: 'SCHEDULE_CONFIG' });
  });

  it('never lets ACTIVE_RECOVERY override a user-selected training day', () => {
    expect(resolveEffectiveCalendarAuthority({
      program: fixedProgram,
      scheduleConfig: { scheduleMode: 'fixed', trainingDays: ['MON', 'WED', 'SUN'] },
    }).activeRecoveryDays).toEqual([]);
  });
});
