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
  it('treats a legacy program without scheduleMode as fixed', () => {
    expect(context({}).config).toMatchObject({ scheduleMode: 'fixed', trainingDays: ['MON', 'WED', 'FRI'] });
    expect(context({}, { scheduleMode: 'flexible', trainingDays: [] }).config.scheduleMode).toBe('fixed');
  });

  it('uses only sealed program/ProgramInstance mode and ignores client-writable config mode', () => {
    expect(context(
      { scheduleMode: 'fixed' },
      { scheduleMode: 'flexible', trainingDays: [] },
      { scheduleMode: 'flexible', trainingDays: null },
    ).config.scheduleMode)
      .toBe('fixed');
    expect(context({ scheduleMode: 'flexible', weeklySchedule: [] }).config)
      .toMatchObject({ scheduleMode: 'flexible' });
    expect(context({}, { scheduleMode: 'fixed' }, { scheduleMode: 'flexible', trainingDays: null }).config.scheduleMode)
      .toBe('flexible');
  });
});
