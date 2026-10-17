import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestNutritionPlanGeneration, subscribeToNutritionGenerationJob, monitorNutritionGenerationJob, generationPlanIsReady } from '../nutritionGeneration';
const mocks = vi.hoisted(() => ({ call: vi.fn(), snapshot: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.call }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), onSnapshot: mocks.snapshot }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'aabbccdd-1234-4321-abcd-123456789000' }));
vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../lib/firebaseFunctions', () => ({ functions: {} }));
vi.mock('../../lib/logger', () => ({ logOperationalInfo: mocks.info, logWarn: mocks.warn,
  errorCode: (error: { code?: string }) => error.code, errorReason: () => undefined }));

beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe('nutrition generation diagnostics', () => {
  it('sends an idempotency identifier and links the backend job to it', async () => {
    mocks.call.mockResolvedValue({ data: { generationId: 'job-1' } });
    await expect(requestNutritionPlanGeneration()).resolves.toEqual({ generationId: 'job-1' });
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith({ requestId: 'aabbccdd-1234-4321-abcd-123456789000' });
    expect(mocks.info).toHaveBeenCalledWith('nutrition.generation', 'request_completed',
      expect.objectContaining({ generationId: 'job-1', requestId: 'aabbccdd-1234-4321-abcd-123456789000' }));
  });
  it('logs a safe error identifier and preserves rejection without retrying', async () => {
    const error = Object.assign(new Error('sensitive payload'), { code: 'functions/unauthenticated' });
    mocks.call.mockRejectedValue(error);
    await expect(requestNutritionPlanGeneration()).rejects.toBe(error);
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('sensitive payload');
    expect(mocks.warn).toHaveBeenCalledWith('nutrition.generation', 'request_failed',
      expect.objectContaining({ failureCode: 'functions/unauthenticated' }));
  });
  it('reports listener failures and completed jobs without logging the plan or questionnaire', () => {
    const next = vi.fn(); const fail = vi.fn();
    subscribeToNutritionGenerationJob('private-user', 'job-1', next, fail);
    const [, onNext, onError] = mocks.snapshot.mock.calls[0];
    onNext({ exists: () => true, data: () => ({ status: 'completed', privateField: 'sensitive' }) });
    onError({ code: 'permission-denied' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ generationId: 'job-1', status: 'completed' }));
    expect(fail).toHaveBeenCalledWith({ code: 'permission-denied' });
    expect(JSON.stringify([...mocks.info.mock.calls, ...mocks.warn.mock.calls])).not.toMatch(/sensitive|private-user/);
  });
});

describe('generation observation recovery', () => {
  it('recovers a stalled running job after reconnect without another callable and cleans its timer', () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    mocks.snapshot.mockReturnValue(unsubscribe);
    const onJob = vi.fn(); const failed = vi.fn();
    const stop = monitorNutritionGenerationJob('u', 'existing-job', onJob, failed);
    const [, next] = mocks.snapshot.mock.calls[0];
    vi.advanceTimersByTime(12 * 60 * 1000);
    expect(failed).toHaveBeenLastCalledWith(true);
    next({ exists: () => true, data: () => ({ status: 'running' }) });
    expect(failed).toHaveBeenLastCalledWith(false);
    expect(onJob).toHaveBeenLastCalledWith(expect.objectContaining({ generationId: 'existing-job', status: 'running' }));
    vi.advanceTimersByTime(12 * 60 * 1000);
    expect(failed).toHaveBeenLastCalledWith(true);
    next({ exists: () => true, data: () => ({ status: 'completed', planId: 'existing-job' }) });
    expect(failed).toHaveBeenLastCalledWith(false);
    const calls = failed.mock.calls.length;
    vi.advanceTimersByTime(24 * 60 * 1000);
    expect(failed).toHaveBeenCalledTimes(calls);
    expect(mocks.call).not.toHaveBeenCalled();
    stop(); expect(unsubscribe).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('handles missing jobs, listener errors and remount without leaving orphan timers', () => {
    vi.useFakeTimers();
    mocks.snapshot.mockReturnValue(vi.fn());
    const failed = vi.fn();
    const stop = monitorNutritionGenerationJob('u', 'job', vi.fn(), failed);
    const [, next, error] = mocks.snapshot.mock.calls[0];
    next({ exists: () => false }); expect(failed).toHaveBeenLastCalledWith(true);
    error(new Error('offline')); expect(failed).toHaveBeenLastCalledWith(true);
    stop();
    const again = monitorNutritionGenerationJob('u', 'job', vi.fn(), failed);
    expect(failed).toHaveBeenLastCalledWith(false);
    again();
    const calls = failed.mock.calls.length;
    vi.advanceTimersByTime(13 * 60 * 1000);
    expect(failed).toHaveBeenCalledTimes(calls);
    expect(mocks.call).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('waits for the matching active plan in either listener delivery order', () => {
    const completed = { status: 'completed' as const, planId: 'new' };
    expect(generationPlanIsReady(completed, null)).toBe(false);
    expect(generationPlanIsReady(completed, { planId: 'old' })).toBe(false);
    expect(generationPlanIsReady({ ...completed, status: 'running' }, { planId: 'new' })).toBe(false);
    expect(generationPlanIsReady(completed, { planId: 'new' })).toBe(true);
  });
});
