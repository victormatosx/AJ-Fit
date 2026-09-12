import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  finalizeWorkoutSession,
  resetFinalizeWorkoutSessionTransportForTests,
  setFinalizeWorkoutSessionTransportForTests,
  workoutFinalizationFailureStage,
} from '../finalizeWorkoutSession';

describe('finalizeWorkoutSession client boundary', () => {
  afterEach(() => resetFinalizeWorkoutSessionTransportForTests());

  it('sends only executionId for strength and returns the durable result', async () => {
    const transport = vi.fn(async () => ({
      status: 'COMPLETED' as const,
      executionStatus: 'PARTIALLY_COMPLETED' as const,
      cardioStatus: 'NOT_APPLICABLE' as const,
      scheduleStatus: 'COMPLETED' as const,
    }));
    setFinalizeWorkoutSessionTransportForTests(transport);
    await expect(finalizeWorkoutSession({ executionId: 'exec_1' })).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(transport).toHaveBeenCalledWith({ executionId: 'exec_1' });
  });

  it('preserves the same executionId/cardio payload across an offline failure and explicit retry', async () => {
    const input = { executionId: 'exec_1', cardio: { actualDurationSeconds: 600 } };
    const transport = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'functions/unavailable' }))
      .mockResolvedValueOnce({
        status: 'COMPLETED', executionStatus: 'COMPLETED',
        cardioStatus: 'COMPLETED', scheduleStatus: 'COMPLETED',
      });
    setFinalizeWorkoutSessionTransportForTests(transport);
    await expect(finalizeWorkoutSession(input)).rejects.toMatchObject({ code: 'functions/unavailable' });
    await expect(finalizeWorkoutSession(input)).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(transport).toHaveBeenNthCalledWith(1, input);
    expect(transport).toHaveBeenNthCalledWith(2, input);
  });

  it('maps server Schedule-stage failures without trusting client-supplied status', () => {
    expect(workoutFinalizationFailureStage({ details: { stage: 'SCHEDULE' } })).toBe('SCHEDULE');
    expect(workoutFinalizationFailureStage({ details: { stage: 'EXECUTION' } })).toBe('EXECUTION');
    expect(workoutFinalizationFailureStage(new Error('offline'))).toBe('EXECUTION');
  });
});
