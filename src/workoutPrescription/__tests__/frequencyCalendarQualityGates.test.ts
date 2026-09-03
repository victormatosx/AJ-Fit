import { describe, expect, it } from 'vitest';

import { WEEKDAY_ORDER, type Quiz, type Weekday } from '../../state/AppState';
import { localDateInTimezone } from '../../scheduleEngine/localDate';
import { resolveWorkoutSchedule } from '../../scheduleEngine/resolver';
import type { ScheduleConfig } from '../../scheduleEngine/types';
import { WORKOUT_TEMPLATES } from '../catalog';
import { generateWorkoutPrescription } from '../engine';
import { selectTemplate } from '../selection';
import { sessionDayState, selectTrainingWeekdays } from '../weeklySchedule';
import { completeAnswers, realLimitationCatalogFixture } from './fixtures';

const limitationCatalog = realLimitationCatalogFixture();

function availableDays(count: number): Weekday[] {
  return WEEKDAY_ORDER.slice(0, count);
}

function answers(overrides: Partial<Quiz> = {}): Quiz {
  const days = overrides.days ?? 7;
  return completeAnswers({
    days,
    trainingDays: availableDays(days),
    ...overrides,
  });
}

function successfulPlan(input: Quiz) {
  const result = generateWorkoutPrescription(input, {
    exerciseCatalog: input.limits.length > 0 ? limitationCatalog : undefined,
  });
  expect(result.status).toBe('SUCCESS');
  if (result.status !== 'SUCCESS') throw new Error(result.status);
  return result.plan;
}

function counts(plan: ReturnType<typeof successfulPlan>) {
  return plan.weeklySchedule?.reduce((result, day) => {
    result[day.state] += 1;
    return result;
  }, { TRAINING: 0, ACTIVE_RECOVERY: 0, REST: 0 }) ?? { TRAINING: 0, ACTIVE_RECOVERY: 0, REST: 0 };
}

describe('Phase 2 availability, frequency and calendar quality gates', () => {
  it('QG2-01 — availability is a ceiling for the full conventional matrix', () => {
    for (const days of [2, 3, 4, 5, 6, 7]) {
      for (const level of ['never_or_starting', 'beginner', 'intermediate', 'advanced'] as const) {
        const plan = successfulPlan(answers({ days, trainingDays: availableDays(days), level }));
        expect(plan.prescribedTrainingFrequency).toBeLessThanOrEqual(days);
        expect(counts(plan).TRAINING).toBe(plan.prescribedTrainingFrequency);
      }
    }
  });

  it('QG2-02/QG2-03/QG2-04 — seven available days always retain REST', () => {
    const expected = { beginner: 4, intermediate: 5, advanced: 6 } as const;
    for (const level of Object.keys(expected) as Array<keyof typeof expected>) {
      const plan = successfulPlan(answers({ level }));
      expect(plan.prescribedTrainingFrequency).toBe(expected[level]);
      expect(counts(plan).TRAINING).toBeLessThanOrEqual(6);
      expect(counts(plan).REST).toBeGreaterThanOrEqual(1);
    }
  });

  it('QG2-05/QG2-06 — 2–5 remain exact; 6 follows experience deterministically', () => {
    for (const days of [2, 3, 4, 5]) {
      expect(successfulPlan(answers({ days, trainingDays: availableDays(days) })).prescribedTrainingFrequency).toBe(days);
    }
    expect(['beginner', 'intermediate', 'advanced'].map((level) =>
      successfulPlan(answers({ days: 6, trainingDays: availableDays(6), level: level as Quiz['level'] })).prescribedTrainingFrequency,
    )).toEqual([4, 5, 6]);
  });

  it('QG2-07 — selected weekdays are deterministic subsets of concrete availability', () => {
    const available: Weekday[] = ['MON', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const plan = successfulPlan(answers({ days: 6, trainingDays: available, level: 'beginner' }));
    const scheduled = plan.weeklySchedule?.filter((day) => day.state === 'TRAINING').map((day) => day.weekday) ?? [];
    expect(scheduled).toHaveLength(4);
    expect(scheduled.every((day) => available.includes(day))).toBe(true);
    expect(selectTrainingWeekdays(available, 4)).toEqual(scheduled);
    expect(successfulPlan(answers({ days: 6, trainingDays: available, level: 'beginner' })).weeklySchedule)
      .toEqual(plan.weeklySchedule);
  });

  it('QG2-08 — TRAINING, ACTIVE_RECOVERY and REST remain distinct', () => {
    expect(sessionDayState({ type: 'strength' })).toBe('TRAINING');
    expect(sessionDayState({ type: 'recovery' })).toBe('ACTIVE_RECOVERY');
    const plan = successfulPlan(answers({
      sex: 'm',
      days: 4,
      trainingDays: ['MON', 'WED', 'FRI', 'SUN'],
      specialConditions: ['functional_limitation'],
      functionalScreening: { situations: ['stairs_difficulty'] },
    }));
    expect(plan.templateId).toBe('T087');
    expect(counts(plan)).toEqual({ TRAINING: 3, ACTIVE_RECOVERY: 1, REST: 3 });
  });

  it('QG2-09 — pregnancy, postpartum and frailty preserve their caps', () => {
    const pregnancy = successfulPlan(answers({
      sex: 'f', specialConditions: ['pregnancy'],
      pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] },
    }));
    const postpartum = successfulPlan(answers({
      sex: 'f', specialConditions: ['postpartum'],
      postpartumScreening: { timeSinceBirth: '3_6_months', deliveryType: 'vaginal', signs: ['none'], returnClearance: 'yes' },
    }));
    const frailty = successfulPlan(answers({
      specialConditions: ['functional_limitation'], functionalScreening: { situations: ['stairs_difficulty'] },
    }));
    expect(pregnancy.prescribedTrainingFrequency).toBeLessThanOrEqual(4);
    expect(postpartum.prescribedTrainingFrequency).toBeLessThanOrEqual(4);
    expect(frailty.prescribedTrainingFrequency).toBeLessThanOrEqual(3);
  });

  it('QG2-10 — a missed workout adjacent to recovery keeps recovery and rotation intact', () => {
    const config: ScheduleConfig = {
      trainingDays: ['MON', 'WED', 'FRI'], activeRecoveryDays: ['TUE'], timezone: 'UTC', scheduleVersion: 1,
    };
    const recovery = resolveWorkoutSchedule({
      hasActiveProgram: true, sessionCount: 3, config,
      state: { nextSessionIndex: 1, cursorDate: '2026-08-03', lastCompletedAt: '2026-08-03', pendingMissDecision: null },
      activatedAtLocalDate: '2026-08-03', todayLocalDate: '2026-08-04',
    });
    expect(recovery).toEqual({ status: 'ACTIVE_RECOVERY_DAY', nextWorkoutDate: '2026-08-05', nextSessionIndex: 1 });
    const missedAfterRecovery = resolveWorkoutSchedule({
      hasActiveProgram: true, sessionCount: 3, config,
      state: { nextSessionIndex: 0, cursorDate: '2026-08-02', lastCompletedAt: null, pendingMissDecision: null },
      activatedAtLocalDate: '2026-08-03', todayLocalDate: '2026-08-05',
    });
    expect(missedAfterRecovery).toEqual({
      status: 'MISSED_SESSION_DECISION_REQUIRED', missedSessionIndex: 0, calendarSessionIndex: 1,
    });
  });

  it('QG2-11 — timezone boundaries preserve recovery/rest classification', () => {
    const instant = new Date('2026-08-04T01:30:00.000Z');
    expect(localDateInTimezone(instant, 'America/Sao_Paulo')).toBe('2026-08-03');
    expect(localDateInTimezone(instant, 'UTC')).toBe('2026-08-04');
    const config: ScheduleConfig = { trainingDays: ['MON'], activeRecoveryDays: ['TUE'], timezone: 'UTC', scheduleVersion: 1 };
    expect(resolveWorkoutSchedule({
      hasActiveProgram: true, sessionCount: 1, config, state: null,
      activatedAtLocalDate: '2026-08-04', todayLocalDate: '2026-08-04',
    }).status).toBe('ACTIVE_RECOVERY_DAY');
  });

  it('QG2-13 — same questionnaire produces identical plan identity and layout', () => {
    const input = answers({ days: 7, level: 'advanced' });
    expect(successfulPlan(input)).toEqual(successfulPlan(input));
  });

  it('QG2-14 — Phase 1 catalog/cardio/displayName contracts remain intact', () => {
    expect(WORKOUT_TEMPLATES).toHaveLength(90);
    expect(WORKOUT_TEMPLATES.every((template) => template.sessions.every((session) => Boolean(session.display_name?.trim())))).toBe(true);
    expect(WORKOUT_TEMPLATES.some((template) => template.sessions.some((session) => session.cardio_finisher))).toBe(true);
  });
});

describe('Phase 2 required 20-persona matrix', () => {
  const cases: Array<[string, Partial<Quiz>]> = [
    ['male gym hypertrophy 2 beginner', { days: 2, trainingDays: availableDays(2), level: 'beginner' }],
    ['male gym hypertrophy 3 beginner', { days: 3, trainingDays: availableDays(3), level: 'beginner' }],
    ['male gym hypertrophy 4 beginner', { days: 4, trainingDays: availableDays(4), level: 'beginner' }],
    ['male gym hypertrophy 5 beginner', { days: 5, trainingDays: availableDays(5), level: 'beginner' }],
    ['male gym hypertrophy 6 beginner', { days: 6, trainingDays: availableDays(6), level: 'beginner' }],
    ['male gym hypertrophy 7 beginner', { level: 'beginner' }],
    ['male gym hypertrophy 7 intermediate', { level: 'intermediate' }],
    ['male gym hypertrophy 7 advanced', { level: 'advanced' }],
    ['female gym hypertrophy 7 beginner', { sex: 'f', level: 'beginner' }],
    ['female gym hypertrophy 7 advanced', { sex: 'f', level: 'advanced' }],
    ['home 7 beginner', { place: 'home', equipment: ['bodyweight', 'dumbbells', 'bands', 'bench_or_box', 'barbell'], level: 'beginner' }],
    ['home 7 experienced', { place: 'home', equipment: ['bodyweight', 'dumbbells', 'bands', 'bench_or_box', 'barbell'], level: 'advanced' }],
    ['strength 7 experienced', { goal: 'strength', level: 'advanced' }],
    ['conditioning 7', { goal: 'conditioning', level: 'intermediate' }],
    ['pregnancy 7', { sex: 'f', specialConditions: ['pregnancy'], pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] } }],
    ['postpartum 7', { sex: 'f', specialConditions: ['postpartum'], postpartumScreening: { timeSinceBirth: '3_6_months', deliveryType: 'vaginal', signs: ['none'], returnClearance: 'yes' } }],
    ['frailty 7', { specialConditions: ['functional_limitation'], functionalScreening: { situations: ['stairs_difficulty'] } }],
    ['knee limitation 7', { specialConditions: ['musculoskeletal_limitation'], limits: ['knee'] }],
    ['wrist limitation 7', { specialConditions: ['musculoskeletal_limitation'], limits: ['wrist'] }],
    ['multiple limitations 7', { specialConditions: ['musculoskeletal_limitation'], limits: ['knee', 'wrist'] }],
  ];

  it.each(cases)('%s', (_label, overrides) => {
    const plan = successfulPlan(answers(overrides));
    const metrics = counts(plan);
    expect(plan.prescribedTrainingFrequency).toBeLessThanOrEqual(plan.availability?.days ?? 0);
    expect(metrics.TRAINING).toBe(plan.prescribedTrainingFrequency);
    expect(plan.weeklySchedule).toHaveLength(7);
    expect(plan.weeklySchedule?.filter((day) => day.state === 'TRAINING').every((day) =>
      plan.availability?.weekdays.includes(day.weekday))).toBe(true);
  });
});
