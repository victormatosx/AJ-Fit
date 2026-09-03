import { describe, expect, it } from 'vitest';
import { evaluateWorkoutProgression } from '../resolver';
import type { EvaluateWorkoutProgressionInput } from '../types';

function base(overrides: Partial<EvaluateWorkoutProgressionInput> = {}): EvaluateWorkoutProgressionInput {
  return {
    hasValidActiveProgram: true,
    adaptationStage: 1,
    activatedAtLocalDate: '2026-08-01',
    todayLocalDate: '2026-08-08', // 7 days later
    trainingDaysPerWeek: 4,
    completedOrPartialSessionCount: 4,
    hasActiveExecution: false,
    ...overrides,
  };
}

describe('evaluateWorkoutProgression — top-level gates', () => {
  it('INVALID_PROGRAM_STATE when there is no valid active program', () => {
    expect(evaluateWorkoutProgression(base({ hasValidActiveProgram: false }))).toEqual({ status: 'INVALID_PROGRAM_STATE' });
  });

  it('BLOCKED_ACTIVE_EXECUTION takes priority over any eligibility, even when otherwise eligible (docs §23/§36/§72/§93)', () => {
    expect(evaluateWorkoutProgression(base({ hasActiveExecution: true }))).toEqual({ status: 'BLOCKED_ACTIVE_EXECUTION' });
  });
});

describe('evaluateWorkoutProgression — Beginner Stage 1 → 2 (docs §62-64, §83)', () => {
  it('§62 no training at all: NOT_ELIGIBLE, MINIMUM_SESSIONS_NOT_REACHED (and time, since 10 days alone is fine but 0 sessions blocks it)', () => {
    const result = evaluateWorkoutProgression(base({ todayLocalDate: '2026-08-11', completedOrPartialSessionCount: 0 })); // 10 days
    expect(result).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['MINIMUM_SESSIONS_NOT_REACHED'] });
  });

  it('§63/§83 trains fast: 4/4 sessions in 4 days → NOT_ELIGIBLE, MINIMUM_TIME_NOT_REACHED only', () => {
    const result = evaluateWorkoutProgression(base({ todayLocalDate: '2026-08-05', completedOrPartialSessionCount: 4 })); // 4 days
    expect(result).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['MINIMUM_TIME_NOT_REACHED'] });
  });

  it('§83 6 days + sufficient sessions → still NOT_ELIGIBLE (time not reached)', () => {
    const result = evaluateWorkoutProgression(base({ todayLocalDate: '2026-08-07', completedOrPartialSessionCount: 4 })); // 6 days
    expect(result).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['MINIMUM_TIME_NOT_REACHED'] });
  });

  it('§83 7 days + insufficient sessions → NOT_ELIGIBLE (sessions not reached)', () => {
    const result = evaluateWorkoutProgression(base({ todayLocalDate: '2026-08-08', completedOrPartialSessionCount: 2 }));
    expect(result).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['MINIMUM_SESSIONS_NOT_REACHED'] });
  });

  it('reports BOTH reason codes when neither gate is met', () => {
    const result = evaluateWorkoutProgression(base({ todayLocalDate: '2026-08-03', completedOrPartialSessionCount: 0 })); // 2 days
    expect(result).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['MINIMUM_TIME_NOT_REACHED', 'MINIMUM_SESSIONS_NOT_REACHED'] });
  });

  it('§64/§83 7 days + sufficient sessions → BEGINNER_STAGE_PROGRESSION_AVAILABLE 1→2', () => {
    const result = evaluateWorkoutProgression(base({ todayLocalDate: '2026-08-08', completedOrPartialSessionCount: 4 }));
    expect(result).toEqual({ status: 'BEGINNER_STAGE_PROGRESSION_AVAILABLE', fromStage: 1, toStage: 2 });
  });
});

describe('evaluateWorkoutProgression — Beginner Stage 2 → 3 (docs §65/§88)', () => {
  it('same gates, same shape, different stage numbers', () => {
    const eligible = evaluateWorkoutProgression(base({ adaptationStage: 2, todayLocalDate: '2026-08-08', completedOrPartialSessionCount: 4 }));
    expect(eligible).toEqual({ status: 'BEGINNER_STAGE_PROGRESSION_AVAILABLE', fromStage: 2, toStage: 3 });

    const notYet = evaluateWorkoutProgression(base({ adaptationStage: 2, todayLocalDate: '2026-08-05', completedOrPartialSessionCount: 4 }));
    expect(notYet).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['MINIMUM_TIME_NOT_REACHED'] });
  });
});

describe('evaluateWorkoutProgression — Stage 3 never re-enters weekly gating (docs §66/§89)', () => {
  it('Stage 3 at 7 days with sessions met does NOT return a beginner-stage result — falls through to the normal-cycle gate (still far short of 90 days)', () => {
    const result = evaluateWorkoutProgression(base({ adaptationStage: 3, todayLocalDate: '2026-08-08', completedOrPartialSessionCount: 4 }));
    expect(result.status).toBe('NOT_ELIGIBLE');
    if (result.status === 'NOT_ELIGIBLE') expect(result.reasonCodes).toContain('PROGRAM_AGE_NOT_REACHED');
  });
});

describe('evaluateWorkoutProgression — frequencies 2–7 (docs §84)', () => {
  it.each([2, 3, 4, 5, 6, 7])('%i trainingDays/week: exactly that many sessions in >=7 days is eligible, one fewer is not', (days) => {
    const eligible = evaluateWorkoutProgression(base({ trainingDaysPerWeek: days, todayLocalDate: '2026-08-08', completedOrPartialSessionCount: days }));
    expect(eligible.status).toBe('BEGINNER_STAGE_PROGRESSION_AVAILABLE');

    const oneShort = evaluateWorkoutProgression(base({ trainingDaysPerWeek: days, todayLocalDate: '2026-08-08', completedOrPartialSessionCount: days - 1 }));
    expect(oneShort).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['MINIMUM_SESSIONS_NOT_REACHED'] });
  });
});

describe('evaluateWorkoutProgression — normal 90-day cycle (docs §90)', () => {
  const normal = (overrides: Partial<EvaluateWorkoutProgressionInput> = {}) =>
    base({ adaptationStage: undefined, activatedAtLocalDate: '2026-01-01', trainingDaysPerWeek: 4, ...overrides });

  it('§90 89 days → not eligible regardless of adherence', () => {
    const result = evaluateWorkoutProgression(normal({ todayLocalDate: '2026-03-31', completedOrPartialSessionCount: 1000 })); // 89 days
    expect(result).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['PROGRAM_AGE_NOT_REACHED'] });
  });

  it('§73/§90 90 days + low adherence → not eligible (never rotate on time alone)', () => {
    const result = evaluateWorkoutProgression(normal({ todayLocalDate: '2026-04-01', completedOrPartialSessionCount: 2 })); // 90 days, ~2/51 sessions
    expect(result).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['ADHERENCE_TOO_LOW'] });
  });

  it('§74/§90 90 days + >=60% adherence (4/week ≈ 51 expected, needs ~31) → NORMAL_ROTATION_AVAILABLE', () => {
    const result = evaluateWorkoutProgression(normal({ todayLocalDate: '2026-04-01', completedOrPartialSessionCount: 31 })); // 90 days
    expect(result).toEqual({ status: 'NORMAL_ROTATION_AVAILABLE' });
  });

  it('30 sessions (one short of the 31 threshold) is not enough', () => {
    const result = evaluateWorkoutProgression(normal({ todayLocalDate: '2026-04-01', completedOrPartialSessionCount: 30 }));
    expect(result).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['ADHERENCE_TOO_LOW'] });
  });

  it('adaptationStage undefined (never a Beginner, e.g. intermediate/advanced from day one) uses the same normal-cycle gate', () => {
    const result = evaluateWorkoutProgression(normal({ adaptationStage: undefined, todayLocalDate: '2026-04-01', completedOrPartialSessionCount: 31 }));
    expect(result).toEqual({ status: 'NORMAL_ROTATION_AVAILABLE' });
  });

  it('§75 200 days without adherence still reports NOT_ELIGIBLE — no cascade of multiple pending rotations', () => {
    const result = evaluateWorkoutProgression(normal({ todayLocalDate: '2026-07-20', completedOrPartialSessionCount: 5 })); // ~200 days
    expect(result.status).toBe('NOT_ELIGIBLE');
  });
});

describe('evaluateWorkoutProgression — determinism (docs §49)', () => {
  it('identical inputs always produce an identical (deep-equal) result', () => {
    const input = base({ todayLocalDate: '2026-08-08', completedOrPartialSessionCount: 4 });
    const a = evaluateWorkoutProgression(input);
    const b = evaluateWorkoutProgression({ ...input });
    expect(a).toEqual(b);
  });
});
