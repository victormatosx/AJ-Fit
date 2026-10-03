import { describe, expect, it } from 'vitest';

import {
  computeExerciseMaxLoadKg,
  computeSessionMaxLoadKg,
  computeSessionVolumeKg,
  computeTotalCompletedReps,
  performedExerciseIds,
} from '../metrics';
import { buildExecution, completedSet, exercise, skippedSet } from './testFixtures';

describe('computeSessionVolumeKg', () => {
  it('sums weightKg x actualReps over COMPLETED, reps-based sets only', () => {
    const execution = buildExecution({
      executionId: 'e1',
      scheduledLocalDate: '2026-09-01',
      exercises: [
        exercise('bench', 0, [completedSet(60, 10), completedSet(60, 8), skippedSet()]),
        exercise('row', 1, [completedSet(40, 12)]),
      ],
    });
    expect(computeSessionVolumeKg(execution)).toBe(60 * 10 + 60 * 8 + 40 * 12);
  });

  it('counts bodyweight sets (weightKg = 0) as zero volume, never skipping or crashing', () => {
    const execution = buildExecution({
      executionId: 'e1',
      scheduledLocalDate: '2026-09-01',
      exercises: [exercise('pullup', 0, [completedSet(0, 10)])],
    });
    expect(computeSessionVolumeKg(execution)).toBe(0);
  });

  it('ignores duration-based sets (no actualReps)', () => {
    const execution = buildExecution({
      executionId: 'e1',
      scheduledLocalDate: '2026-09-01',
      exercises: [exercise('plank', 0, [{ setIndex: 0, status: 'COMPLETED', actualReps: null, weightKg: null, actualDurationSeconds: 60 }])],
    });
    expect(computeSessionVolumeKg(execution)).toBe(0);
  });

  it('returns 0 for a null/undefined execution', () => {
    expect(computeSessionVolumeKg(null)).toBe(0);
    expect(computeSessionVolumeKg(undefined)).toBe(0);
  });
});

describe('computeTotalCompletedReps', () => {
  it('sums actualReps over COMPLETED sets only', () => {
    const execution = buildExecution({
      executionId: 'e1',
      scheduledLocalDate: '2026-09-01',
      exercises: [exercise('bench', 0, [completedSet(60, 10), skippedSet(), completedSet(60, 8)])],
    });
    expect(computeTotalCompletedReps(execution)).toBe(18);
  });
});

describe('computeSessionMaxLoadKg', () => {
  it('finds the heaviest COMPLETED set across the whole session', () => {
    const execution = buildExecution({
      executionId: 'e1',
      scheduledLocalDate: '2026-09-01',
      exercises: [
        exercise('bench', 0, [completedSet(60, 10)]),
        exercise('squat', 1, [completedSet(100, 5), completedSet(80, 8)]),
      ],
    });
    expect(computeSessionMaxLoadKg(execution)).toBe(100);
  });

  it('is 0 when nothing valid was logged (bodyweight/duration-only session)', () => {
    const execution = buildExecution({
      executionId: 'e1',
      scheduledLocalDate: '2026-09-01',
      exercises: [exercise('pullup', 0, [completedSet(0, 10)])],
    });
    expect(computeSessionMaxLoadKg(execution)).toBe(0);
  });
});

describe('computeExerciseMaxLoadKg', () => {
  it('returns the max for one exercise id, null when it has no valid load', () => {
    const execution = buildExecution({
      executionId: 'e1',
      scheduledLocalDate: '2026-09-01',
      exercises: [
        exercise('bench', 0, [completedSet(60, 10), completedSet(65, 8)]),
        exercise('pullup', 1, [completedSet(0, 10)]),
      ],
    });
    expect(computeExerciseMaxLoadKg(execution, 'bench')).toBe(65);
    expect(computeExerciseMaxLoadKg(execution, 'pullup')).toBeNull();
    expect(computeExerciseMaxLoadKg(execution, 'unknown')).toBeNull();
  });
});

describe('performedExerciseIds', () => {
  it('only lists exercises with at least one COMPLETED set, deduped, in exerciseIndex order', () => {
    const execution = buildExecution({
      executionId: 'e1',
      scheduledLocalDate: '2026-09-01',
      exercises: [
        exercise('row', 1, [completedSet(40, 12)]),
        exercise('bench', 0, [completedSet(60, 10)]),
        exercise('skippedOnly', 2, [skippedSet()]),
      ],
    });
    expect(performedExerciseIds(execution)).toEqual(['bench', 'row']);
  });
});
