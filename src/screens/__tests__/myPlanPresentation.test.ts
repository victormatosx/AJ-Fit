import { describe, expect, it } from 'vitest';
import { buildAdaptationFlags, buildWeekView, hasAnyAdaptation } from '../myPlanPresentation';
import { generateWorkoutPrescription } from '../../workoutPrescription/engine';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import type { PrescriptionTrace } from '../../workoutPrescription/types';
import type { ScheduleResolution } from '../../scheduleEngine/types';

const emptyTrace: PrescriptionTrace = {
  selectionReasons: [],
  safety: { status: 'CLEAR', reasons: [], requiredModifierIds: [], protectedConstraints: [] },
  appliedModifiers: [],
  unresolvedModifiers: [],
  conflicts: [],
  substitutions: [],
  limitationResolverVersion: 1,
  limitationDecisions: [],
  compositionDecisions: [],
  validationCodes: [],
};

describe('buildWeekView', () => {
  it('marks only the configured weekdays as training days, in Monday-first order', () => {
    const week = buildWeekView(['MON', 'WED', 'FRI'], 'MON', { status: 'REST_DAY' });
    expect(week.map((d) => d.weekday)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
    expect(week.filter((d) => d.isTrainingDay).map((d) => d.weekday)).toEqual(['MON', 'WED', 'FRI']);
  });

  it('flags exactly one day as today', () => {
    const week = buildWeekView(['MON', 'WED', 'FRI'], 'WED', { status: 'REST_DAY' });
    expect(week.filter((d) => d.isToday)).toHaveLength(1);
    expect(week.find((d) => d.isToday)?.weekday).toBe('WED');
  });

  it('only attaches a due session to TODAY, and only when the Schedule Engine resolved SESSION_READY', () => {
    const resolution: ScheduleResolution = { status: 'SESSION_READY', sessionIndex: 2 };
    const week = buildWeekView(['MON', 'WED', 'FRI'], 'WED', resolution);
    for (const day of week) {
      if (day.isToday) expect(day.dueSessionIndex).toBe(2);
      else expect(day.dueSessionIndex).toBeNull();
    }
  });

  it('never guesses a due session for a non-SESSION_READY resolution, even today', () => {
    const week = buildWeekView(['MON'], 'MON', { status: 'SCHEDULE_SETUP_REQUIRED' });
    expect(week.every((d) => d.dueSessionIndex === null)).toBe(true);
  });
});

describe('buildAdaptationFlags', () => {
  it('reports no adaptation when the trace has no evidence at all', () => {
    const flags = buildAdaptationFlags(emptyTrace);
    expect(flags).toEqual({ equipment: false, limitations: false, experience: false, duration: false });
    expect(hasAnyAdaptation(flags)).toBe(false);
  });

  it('flags equipment only when a real substitution exists', () => {
    const trace: PrescriptionTrace = {
      ...emptyTrace,
      substitutions: [{ sessionIndex: 0, fromExerciseId: 'a', toExerciseId: 'b', reasonCode: 'EQUIPMENT_UNAVAILABLE' }],
    };
    expect(buildAdaptationFlags(trace).equipment).toBe(true);
  });

  it('flags experience only for beginner-driven composition decisions, not duration-driven ones', () => {
    const trace: PrescriptionTrace = {
      ...emptyTrace,
      compositionDecisions: [{ reasonCode: 'BEGINNER_SESSION_REDUCED', sessionIndex: 0 }],
    };
    const flags = buildAdaptationFlags(trace);
    expect(flags.experience).toBe(true);
    expect(flags.duration).toBe(false);
  });

  it('a real generated plan\'s own trace shape is accepted without throwing', () => {
    const answers = completeAnswers({ days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle', level: 'intermediate' });
    const result = generateWorkoutPrescription(answers);
    if (result.status !== 'SUCCESS') throw new Error(`fixture setup failed: ${result.status}`);
    expect(() => buildAdaptationFlags(result.plan.trace)).not.toThrow();
  });
});
