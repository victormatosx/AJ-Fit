import { describe, expect, it } from 'vitest';

import { deriveMuscleGroupLoadGains } from '../muscleGroupLoadProgress';
import type { ExerciseLoadProgress } from '../loadProgress';

const TODAY = '2026-10-16';

/** Real bundled-catalog ids, so `getExerciseTarget` resolves a real muscle. */
const SQUAT = 'barbell-back-squat'; // quads
const DEADLIFT = 'conventional-deadlift'; // glutes
const BENCH = 'machine-flat-bench-press'; // chest

function exercise(
  exerciseId: string,
  points: readonly [string, number][],
): ExerciseLoadProgress {
  return {
    exerciseId,
    history: points.map(([localDate, loadKg], index) => ({
      executionId: `${exerciseId}-${index}`,
      localDate,
      loadKg,
    })),
  };
}

describe('deriveMuscleGroupLoadGains', () => {
  it('groups by the catalog primary muscle and ranks by gain', () => {
    const gains = deriveMuscleGroupLoadGains(
      [
        exercise(SQUAT, [['2026-09-01', 100], ['2026-10-01', 110]]),
        exercise(DEADLIFT, [['2026-09-01', 100], ['2026-10-01', 125]]),
      ],
      90,
      TODAY,
    );

    expect(gains.map((gain) => gain.muscle)).toEqual(['glutes', 'quads']);
    expect(gains[0]!.gainRatio).toBeCloseTo(0.25, 10);
    expect(gains[1]!.gainRatio).toBeCloseTo(0.1, 10);
  });

  it('averages the exercises of a group instead of taking the best one', () => {
    const gains = deriveMuscleGroupLoadGains(
      [
        exercise(BENCH, [['2026-09-01', 100], ['2026-10-01', 120]]),
        // Same primary muscle (chest) as the machine bench press.
        exercise('pec-deck-machine-fly', [['2026-09-01', 100], ['2026-10-01', 100]]),
      ],
      90,
      TODAY,
    );

    expect(gains).toHaveLength(1);
    expect(gains[0]!.muscle).toBe('chest');
    expect(gains[0]!.exerciseCount).toBe(2);
    expect(gains[0]!.gainRatio).toBeCloseTo(0.1, 10);
  });

  it('reports the heaviest real point of the group as its best mark', () => {
    const gains = deriveMuscleGroupLoadGains(
      [
        exercise(BENCH, [['2026-09-01', 40], ['2026-10-01', 48]]),
        exercise('pec-deck-machine-fly', [['2026-09-01', 70], ['2026-10-01', 82.5]]),
      ],
      90,
      TODAY,
    );

    expect(gains[0]!.bestExerciseId).toBe('pec-deck-machine-fly');
    expect(gains[0]!.bestLoadKg).toBe(82.5);
  });

  it('never emits a group whose exercises have a single point in the window', () => {
    const gains = deriveMuscleGroupLoadGains(
      [exercise(SQUAT, [['2026-10-01', 100]])],
      90,
      TODAY,
    );

    expect(gains).toEqual([]);
  });

  it('honours the period window rather than the whole history', () => {
    const history = exercise(SQUAT, [
      ['2026-01-10', 60],
      ['2026-10-01', 100],
      ['2026-10-10', 110],
    ]);

    expect(deriveMuscleGroupLoadGains([history], 365, TODAY)[0]!.gainRatio)
      .toBeCloseTo(110 / 60 - 1, 10);
    expect(deriveMuscleGroupLoadGains([history], 30, TODAY)[0]!.gainRatio)
      .toBeCloseTo(0.1, 10);
  });

  it('keeps a real regression negative instead of clamping it to zero', () => {
    const gains = deriveMuscleGroupLoadGains(
      [exercise(SQUAT, [['2026-09-01', 100], ['2026-10-01', 90]])],
      90,
      TODAY,
    );

    expect(gains[0]!.gainRatio).toBeCloseTo(-0.1, 10);
  });

  it('skips exercises missing from the bundled catalog', () => {
    const gains = deriveMuscleGroupLoadGains(
      [exercise('not-a-real-exercise-id', [['2026-09-01', 10], ['2026-10-01', 20]])],
      90,
      TODAY,
    );

    expect(gains).toEqual([]);
  });
});
