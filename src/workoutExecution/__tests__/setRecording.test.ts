import { describe, expect, it, vi } from 'vitest';

import {
  beginSetRecordFlight,
  classifySetRecordFailure,
  projectSetCompleted,
  rollbackOptimisticSetCompletion,
} from '../setRecording';
import type { ExerciseExecution } from '../types';

function exercises(): ExerciseExecution[] {
  return [{
    exerciseIndex: 0,
    exerciseId: 'bench',
    prescribedSets: 2,
    prescribedReps: '8-12',
    prescribedDuration: null,
    prescribedCycles: null,
    sets: [
      { setIndex: 0, status: 'PENDING', actualReps: null, weightKg: null, actualDurationSeconds: null },
      { setIndex: 1, status: 'PENDING', actualReps: null, weightKg: null, actualDurationSeconds: null },
    ],
  }];
}

describe('optimistic set recording', () => {
  it('projects COMPLETED synchronously without waiting for delayed persistence', async () => {
    vi.useFakeTimers();
    try {
      let persisted = false;
      const persistence = new Promise<void>((resolve) => {
        setTimeout(() => { persisted = true; resolve(); }, 250);
      });

      const projected = projectSetCompleted(exercises(), 0, 0, {
        actualReps: 8,
        weightKg: 60,
        actualDurationSeconds: null,
      });

      expect(projected.optimistic.status).toBe('COMPLETED');
      expect(persisted).toBe(false);
      await vi.advanceTimersByTimeAsync(249);
      expect(persisted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await persistence;
      expect(persisted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps rapid different sets independent and coalesces a double tap', async () => {
    const flights = new Map<string, Promise<void>>();
    let release!: () => void;
    let writes = 0;
    const operation = () => {
      writes += 1;
      return new Promise<void>((resolve) => { release = resolve; });
    };
    const first = beginSetRecordFlight(flights, 'set:0:0', operation);
    const duplicate = beginSetRecordFlight(flights, 'set:0:0', operation);
    expect(duplicate).toBe(first);
    expect(writes).toBe(1);
    release();
    await first;

    let projected = projectSetCompleted(exercises(), 0, 0, {
      actualReps: 10, weightKg: 50, actualDurationSeconds: null,
    }).exercises;
    projected = projectSetCompleted(projected, 0, 1, {
      actualReps: 8, weightKg: 55, actualDurationSeconds: null,
    }).exercises;
    expect(projected[0].sets.map((set) => set.status)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(projected[0].sets.map((set) => set.weightKg)).toEqual([50, 55]);
  });

  it('rolls back a permanent failure but never overwrites a newer edit', () => {
    const projection = projectSetCompleted(exercises(), 0, 0, {
      actualReps: 10, weightKg: 50, actualDurationSeconds: null,
    });
    const rolledBack = rollbackOptimisticSetCompletion(
      projection.exercises, 0, 0, projection.optimistic, projection.previous,
    );
    expect(rolledBack[0].sets[0].status).toBe('PENDING');

    const edited = projectSetCompleted(projection.exercises, 0, 0, {
      actualReps: 8, weightKg: 60, actualDurationSeconds: null,
    }).exercises;
    const protectedEdit = rollbackOptimisticSetCompletion(
      edited, 0, 0, projection.optimistic, projection.previous,
    );
    expect(protectedEdit[0].sets[0]).toMatchObject({ status: 'COMPLETED', actualReps: 8, weightKg: 60 });
  });

  it('distinguishes explicit permanent rejects from transient/unknown failures', () => {
    expect(classifySetRecordFailure(Object.assign(new Error('rules'), { code: 'permission-denied' })))
      .toBe('PERMANENT');
    expect(classifySetRecordFailure(new Error('EXECUTION_NOT_IN_PROGRESS'))).toBe('PERMANENT');
    expect(classifySetRecordFailure(Object.assign(new Error('offline'), { code: 'unavailable' })))
      .toBe('RETRYABLE');
    expect(classifySetRecordFailure(new Error('network'))).toBe('RETRYABLE');
  });
});
