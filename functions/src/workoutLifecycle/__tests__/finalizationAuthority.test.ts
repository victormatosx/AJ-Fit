import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { buildScheduleAuthorityContext } from '../finalizationAuthority';

function context(
  program: Record<string, unknown>,
  scheduleConfigData: Record<string, unknown> = {},
  snapshotInputs: Record<string, unknown> = {},
) {
  return buildScheduleAuthorityContext({
    program: {
      prescribedTrainingFrequency: 3,
      sessions: [{}, {}, {}],
      ...program,
    },
    instance: {
      activatedAt: Timestamp.fromDate(new Date('2026-09-14T12:00:00Z')),
      prescriptionInputSnapshot: { inputs: { trainingDays: ['MON', 'WED', 'FRI'], ...snapshotInputs } },
    },
    scheduleConfigData: { trainingDays: ['MON', 'WED', 'FRI'], timezone: 'UTC', ...scheduleConfigData },
    stateData: null,
  });
}

describe('finalization schedule authority', () => {
  it('treats a legacy account with no mode set anywhere as fixed', () => {
    expect(context({}, { trainingDays: ['MON', 'WED', 'FRI'] }).config).toMatchObject({ scheduleMode: 'fixed' });
  });

  it('ScheduleConfig is the calendar authority — its scheduleMode wins over the sealed program and the ProgramInstance snapshot', () => {
    // ScheduleConfig says flexible; sealed program says fixed; snapshot says flexible too — ScheduleConfig wins.
    expect(context(
      { scheduleMode: 'fixed' },
      { scheduleMode: 'flexible', trainingDays: [] },
      { scheduleMode: 'flexible', trainingDays: null },
    ).config.scheduleMode).toBe('flexible');

    // ScheduleConfig says fixed; snapshot says flexible — ScheduleConfig still wins.
    expect(context({}, { scheduleMode: 'fixed' }, { scheduleMode: 'flexible', trainingDays: null })
      .config.scheduleMode).toBe('fixed');
  });

  it('falls back to the sealed program, then the snapshot when ScheduleConfig is absent or inconsistent', () => {
    expect(context({ scheduleMode: 'flexible', weeklySchedule: [] }, { trainingDays: ['MON', 'WED', 'FRI'] })
      .config).toMatchObject({ scheduleMode: 'flexible' });
    expect(context({}, { trainingDays: ['MON', 'WED', 'FRI'] }, { scheduleMode: 'flexible' })
      .config.scheduleMode).toBe('flexible');
  });

  it('ScheduleConfig.trainingDays wins when its length matches the prescribed frequency, even over a populated weeklySchedule', () => {
    expect(context(
      { weeklySchedule: [{ weekday: 'TUE', state: 'TRAINING' }, { weekday: 'THU', state: 'TRAINING' }, { weekday: 'SAT', state: 'TRAINING' }] },
      { trainingDays: ['MON', 'WED', 'FRI'] },
    ).config.trainingDays).toEqual(['MON', 'WED', 'FRI']);
  });

  it('falls back to weeklySchedule when ScheduleConfig.trainingDays length does not match the prescribed frequency (edit left inconsistent, or legacy account)', () => {
    expect(context(
      { weeklySchedule: [
        { weekday: 'TUE', state: 'TRAINING' }, { weekday: 'THU', state: 'TRAINING' }, { weekday: 'SAT', state: 'TRAINING' },
      ] },
      { trainingDays: ['MON', 'WED'] }, // length 2, program prescribes 3 — inconsistent
    ).config.trainingDays).toEqual(['TUE', 'THU', 'SAT']);
  });

  it('falls back to the ProgramInstance snapshot when both ScheduleConfig and weeklySchedule are unusable', () => {
    expect(context(
      { weeklySchedule: [] },
      { trainingDays: [] },
      { trainingDays: ['MON', 'WED', 'FRI'] },
    ).config.trainingDays).toEqual(['MON', 'WED', 'FRI']);
  });

  it('flexible mode never carries trainingDays, regardless of what ScheduleConfig/weeklySchedule hold', () => {
    expect(context(
      {},
      { scheduleMode: 'flexible', trainingDays: [] },
    ).config.trainingDays).toEqual([]);
  });

  it('preserves timezone and program ACTIVE_RECOVERY while ScheduleConfig owns TRAINING days', () => {
    expect(context(
      { weeklySchedule: [
        { weekday: 'TUE', state: 'TRAINING' }, { weekday: 'THU', state: 'TRAINING' },
        { weekday: 'SAT', state: 'TRAINING' }, { weekday: 'SUN', state: 'ACTIVE_RECOVERY' },
      ] },
      { scheduleMode: 'fixed', trainingDays: ['MON', 'WED', 'FRI'], timezone: 'America/Sao_Paulo' },
    ).config).toMatchObject({
      timezone: 'America/Sao_Paulo',
      trainingDays: ['MON', 'WED', 'FRI'],
      activeRecoveryDays: ['SUN'],
    });
  });

  it('rejects duplicate ScheduleConfig weekdays and uses the sealed fallback', () => {
    expect(context(
      { weeklySchedule: [
        { weekday: 'TUE', state: 'TRAINING' }, { weekday: 'THU', state: 'TRAINING' }, { weekday: 'SAT', state: 'TRAINING' },
      ] },
      { scheduleMode: 'fixed', trainingDays: ['MON', 'MON', 'FRI'] },
    ).config.trainingDays).toEqual(['TUE', 'THU', 'SAT']);
  });

  it('uses sessions.length for the rotation even when weekly frequency is lower', () => {
    expect(context({
      prescribedTrainingFrequency: 4,
      sessions: [{}, {}, {}, {}, {}],
    }).sessionCount).toBe(5);
  });
});
