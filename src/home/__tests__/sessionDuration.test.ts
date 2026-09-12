import { describe, expect, it } from 'vitest';
import {
  estimateCardioFinisherSeconds,
  estimateExerciseSeconds,
  estimateSessionMinutes,
  parsePrescribedSeconds,
  repsWorkSeconds,
} from '../sessionDuration';
import { LEGACY_REST_SECONDS_FALLBACK } from '../../workoutPrescription/restPrescription';
import type { FinalWorkoutSession } from '../../workoutPrescription/types';

describe('parsePrescribedSeconds', () => {
  it('reads the midpoint of a seconds range', () => {
    expect(parsePrescribedSeconds('30-45 s')).toBe(37.5);
  });

  it('reads minutes, including the abbreviated "m" the catalog also uses', () => {
    expect(parsePrescribedSeconds('10 min')).toBe(600);
    expect(parsePrescribedSeconds('20-40 min')).toBe(1800);
    expect(parsePrescribedSeconds('20-40 m')).toBe(1800);
  });

  it('sums every segment of a multi-part interval prescription', () => {
    // One full cycle: hard work + its own easy recovery.
    expect(parsePrescribedSeconds('30-45 s forte + 60-90 s leve')).toBe(37.5 + 75);
  });

  it('returns null when there is no time quantity at all', () => {
    expect(parsePrescribedSeconds('')).toBeNull();
    expect(parsePrescribedSeconds('até a falha')).toBeNull();
  });
});

describe('repsWorkSeconds', () => {
  it('uses the midpoint of a rep range', () => {
    expect(repsWorkSeconds('10-12')).toBe(11 * 4);
  });

  it('doubles a unilateral prescription — it is performed once per side', () => {
    expect(repsWorkSeconds('10-12/lado')).toBe(11 * 4 * 2);
    expect(repsWorkSeconds('8-12/perna')).toBe(10 * 4 * 2);
  });

  it('falls back to a documented rep count when nothing is parsable', () => {
    expect(repsWorkSeconds('AMRAP')).toBe(10 * 4);
    expect(repsWorkSeconds(undefined)).toBe(10 * 4);
  });
});

describe('estimateExerciseSeconds', () => {
  it('counts work plus the engine-prescribed rest on every set', () => {
    const seconds = estimateExerciseSeconds({
      exerciseId: 'x', sourceExerciseId: 'x', sets: 3, reps: '10', restSeconds: 90,
    });
    expect(seconds).toBe(3 * (10 * 4 + 90));
  });

  it('honors a deliberate zero rest instead of substituting the legacy fallback', () => {
    const seconds = estimateExerciseSeconds({
      exerciseId: 'x', sourceExerciseId: 'x', sets: 2, reps: '10', restSeconds: 0,
    });
    expect(seconds).toBe(2 * 10 * 4);
  });

  it('uses the documented legacy fallback when a snapshot predates restSeconds', () => {
    const seconds = estimateExerciseSeconds({
      exerciseId: 'x', sourceExerciseId: 'x', sets: 1, reps: '10',
    });
    expect(seconds).toBe(10 * 4 + LEGACY_REST_SECONDS_FALLBACK);
  });

  it('never adds rest on top of an interval prescription — the cycle carries its own', () => {
    const seconds = estimateExerciseSeconds({
      exerciseId: 'x',
      sourceExerciseId: 'x',
      sets: 1,
      cycles: 8,
      duration: '30-45 s forte + 60-90 s leve',
      restSeconds: 90,
    });
    expect(seconds).toBe(8 * (37.5 + 75));
  });

  it('prefers a duration prescription over reps', () => {
    const seconds = estimateExerciseSeconds({
      exerciseId: 'x', sourceExerciseId: 'x', sets: 2, duration: '30-60 s', reps: '10', restSeconds: 30,
    });
    expect(seconds).toBe(2 * (45 + 30));
  });
});

describe('estimateCardioFinisherSeconds', () => {
  it('ignores an integrated finisher — there is no separate block to count', () => {
    expect(estimateCardioFinisherSeconds({
      mode: 'integrated', exerciseOptions: [], duration: '10 min', intensity: 'leve', required: false,
    })).toBe(0);
  });

  it('counts an appended finisher', () => {
    expect(estimateCardioFinisherSeconds({
      mode: 'steady', exerciseOptions: ['bike'], duration: '10 min', intensity: 'leve', required: true,
    })).toBe(600);
  });

  it('is zero when there is no finisher', () => {
    expect(estimateCardioFinisherSeconds(undefined)).toBe(0);
  });
});

describe('estimateSessionMinutes', () => {
  const session = (overrides: Partial<FinalWorkoutSession>): FinalWorkoutSession => ({
    name: 'A', type: 'resistance', exercises: [], ...overrides,
  });

  it('rounds the whole session to minutes', () => {
    // 3 x (44s work + 90s rest) = 402s, x2 exercises = 804s = 13.4min -> 13
    const minutes = estimateSessionMinutes(session({
      exercises: [
        { exerciseId: 'a', sourceExerciseId: 'a', sets: 3, reps: '10-12', restSeconds: 90 },
        { exerciseId: 'b', sourceExerciseId: 'b', sets: 3, reps: '10-12', restSeconds: 90 },
      ],
    }));
    expect(minutes).toBe(13);
  });

  it('includes an appended cardio finisher', () => {
    const withoutFinisher = estimateSessionMinutes(session({
      exercises: [{ exerciseId: 'a', sourceExerciseId: 'a', sets: 3, reps: '10', restSeconds: 60 }],
    }));
    const withFinisher = estimateSessionMinutes(session({
      exercises: [{ exerciseId: 'a', sourceExerciseId: 'a', sets: 3, reps: '10', restSeconds: 60 }],
      cardioFinisher: {
        mode: 'steady', exerciseOptions: ['bike'], duration: '10 min', intensity: 'leve', required: true,
      },
    }));
    expect(withFinisher - withoutFinisher).toBe(10);
  });

  it('returns 0 for a session with nothing to estimate', () => {
    expect(estimateSessionMinutes(session({ exercises: [] }))).toBe(0);
  });
});
