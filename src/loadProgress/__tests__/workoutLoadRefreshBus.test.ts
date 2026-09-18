import { describe, expect, it, vi } from 'vitest';

import {
  publishWorkoutLoadRefresh,
  subscribeToWorkoutLoadRefresh,
} from '../workoutLoadRefreshBus';

describe('workoutLoadRefreshBus', () => {
  it('notifies only consumers for the user whose set was persisted', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = subscribeToWorkoutLoadRefresh('user-a', first);
    subscribeToWorkoutLoadRefresh('user-b', second);

    publishWorkoutLoadRefresh('user-a', 'execution-1');
    expect(first).toHaveBeenCalledWith({ executionId: 'execution-1' });
    expect(second).not.toHaveBeenCalled();

    unsubscribe();
    publishWorkoutLoadRefresh('user-a', 'execution-2');
    expect(first).toHaveBeenCalledTimes(1);
  });
});
