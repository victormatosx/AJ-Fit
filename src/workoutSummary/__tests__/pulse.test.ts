import { describe, expect, it } from 'vitest';

import { buildWorkoutPulse } from '../pulse';
import { buildExecution, completedSet, exercise } from './testFixtures';

describe('buildWorkoutPulse', () => {
  it('reports hasPreviousSession: false with no metrics when there is nothing comparable yet (first-ever session)', () => {
    const current = buildExecution({ executionId: 'e1', scheduledLocalDate: '2026-09-01', exercises: [exercise('bench', 0, [completedSet(60, 10)])] });
    const pulse = buildWorkoutPulse(current, null);
    expect(pulse).toEqual({ hasPreviousSession: false, metrics: null });
  });

  it('computes positive/negative/neutral direction correctly for each metric', () => {
    const current = buildExecution({
      executionId: 'current',
      scheduledLocalDate: '2026-09-08',
      exercises: [exercise('bench', 0, [completedSet(65, 10), completedSet(65, 10)])],
    });
    const previous = buildExecution({
      executionId: 'previous',
      scheduledLocalDate: '2026-09-01',
      exercises: [exercise('bench', 0, [completedSet(60, 10)])],
    });

    const pulse = buildWorkoutPulse(current, previous);
    expect(pulse.hasPreviousSession).toBe(true);
    const metrics = pulse.metrics!;

    // volume: 65*10*2=1300 vs 60*10=600 -> positive
    expect(metrics.volume.currentValue).toBe(1300);
    expect(metrics.volume.previousValue).toBe(600);
    expect(metrics.volume.direction).toBe('positive');
    expect(metrics.volume.deltaPercent).toBeCloseTo(((1300 - 600) / 600) * 100);

    // sets: 2 vs 1 -> positive
    expect(metrics.sets.currentValue).toBe(2);
    expect(metrics.sets.previousValue).toBe(1);
    expect(metrics.sets.direction).toBe('positive');

    // maxLoad: 65 vs 60 -> positive
    expect(metrics.maxLoad.direction).toBe('positive');

    // reps: 20 vs 10 -> positive
    expect(metrics.reps.currentValue).toBe(20);
    expect(metrics.reps.previousValue).toBe(10);
  });

  it('marks direction neutral and deltaPercent null when both sides are equal', () => {
    const current = buildExecution({ executionId: 'current', scheduledLocalDate: '2026-09-08', exercises: [exercise('bench', 0, [completedSet(60, 10)])] });
    const previous = buildExecution({ executionId: 'previous', scheduledLocalDate: '2026-09-01', exercises: [exercise('bench', 0, [completedSet(60, 10)])] });

    const pulse = buildWorkoutPulse(current, previous);
    expect(pulse.metrics!.volume.direction).toBe('neutral');
    expect(pulse.metrics!.volume.deltaPercent).toBe(0);
  });

  it('never divides by zero: deltaPercent is null when the previous value is 0', () => {
    const current = buildExecution({ executionId: 'current', scheduledLocalDate: '2026-09-08', exercises: [exercise('pullup', 0, [completedSet(0, 10)])] });
    const previous = buildExecution({ executionId: 'previous', scheduledLocalDate: '2026-09-01', exercises: [exercise('pullup', 0, [completedSet(0, 8)])] });

    const pulse = buildWorkoutPulse(current, previous);
    expect(pulse.metrics!.maxLoad.previousValue).toBe(0);
    expect(pulse.metrics!.maxLoad.deltaPercent).toBeNull();
  });
});
