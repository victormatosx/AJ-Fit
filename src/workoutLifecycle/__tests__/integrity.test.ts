import { describe, expect, it, vi } from 'vitest';

import { completeWorkoutSessionFlow } from '../finishFlow';
import { WorkoutMutationQueue } from '../mutationQueue';

describe('Execution → Schedule integrity', () => {
  it('does not advance Schedule when finish fails', async () => {
    const completeSchedule = vi.fn(async () => true);
    await expect(completeWorkoutSessionFlow({
      finishExecution: async () => null,
      completeSchedule,
    })).resolves.toBe('EXECUTION_FAILED');
    expect(completeSchedule).not.toHaveBeenCalled();
  });

  it('advances Schedule exactly once after a successful finish', async () => {
    const completeSchedule = vi.fn(async () => true);
    await expect(completeWorkoutSessionFlow({
      finishExecution: async () => 'COMPLETED',
      completeSchedule,
    })).resolves.toBe('COMPLETED');
    expect(completeSchedule).toHaveBeenCalledTimes(1);
  });

  it('keeps the durable workout completed when lifecycle follow-up fails', async () => {
    const finishExecution = vi.fn(async () => 'COMPLETED' as const);
    const completeSchedule = vi.fn(async () => true);
    const afterSchedule = vi.fn(async () => { throw new Error('offline'); });

    await expect(completeWorkoutSessionFlow({
      finishExecution,
      completeSchedule,
      afterSchedule,
    })).resolves.toBe('LIFECYCLE_FOLLOW_UP_FAILED');
    expect(finishExecution).toHaveBeenCalledTimes(1);
    expect(completeSchedule).toHaveBeenCalledTimes(1);
    expect(afterSchedule).toHaveBeenCalledTimes(1);
  });
});

describe('recordSet → finish barrier', () => {
  it('waits for multiple accepted writes before flush resolves', async () => {
    const queue = new WorkoutMutationQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    void queue.enqueue('set:0:0', async () => { await firstGate; order.push('first'); });
    void queue.enqueue('set:0:1', async () => { order.push('second'); });
    const flushing = queue.flush().then(() => order.push('finish'));
    await Promise.resolve();
    expect(order).toEqual([]);
    releaseFirst();
    await flushing;
    expect(order).toEqual(['first', 'second', 'finish']);
  });

  it('blocks finish after a failed set and permits a successful deterministic retry', async () => {
    const queue = new WorkoutMutationQueue();
    await expect(queue.enqueue('set:0:0', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    await expect(queue.flush()).rejects.toThrow('WORKOUT_MUTATIONS_UNRECONCILED:set:0:0');
    await queue.enqueue('set:0:0', async () => undefined);
    await expect(queue.flush()).resolves.toBeUndefined();
  });

  it('reconciles a transiently failed accepted set at the finish barrier', async () => {
    const queue = new WorkoutMutationQueue();
    let attempt = 0;
    const operation = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('transient');
    };
    await expect(queue.enqueue('set:0:0', operation)).rejects.toThrow('transient');
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(attempt).toBe(2);
  });
});
