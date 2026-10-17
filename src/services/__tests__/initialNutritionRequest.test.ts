import { beforeEach, describe, expect, it, vi } from 'vitest';
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => store.get(key) ?? null,
  setItem: async (key: string, value: string) => { store.set(key, value); },
} }));
import { readInitialNutritionRequest, runInitialNutritionRequest, setInitialNutritionDisabled, resolveInitialNutritionRequestPresentation } from '../initialNutritionRequest';
beforeEach(() => { store.clear(); vi.useRealTimers(); });
describe('persistent initial request budget', () => {
  it('survives remount/reopen and caps transient requests at three; explicit recovery is bounded again', async () => {
    vi.useFakeTimers(); const request = vi.fn().mockRejectedValue({ code: 'functions/unavailable' });
    for (let n = 0; n < 5; n++) { await runInitialNutritionRequest('u', request); vi.advanceTimersByTime(31000); }
    expect(request).toHaveBeenCalledTimes(3);
    expect((await readInitialNutritionRequest('u')).status).toBe('exhausted');
    await runInitialNutritionRequest('u', request, true);
    expect((await readInitialNutritionRequest('u')).attempts).toBe(1);
  });
  it('stops definitive authorization failures and scopes state to the UID', async () => {
    const request = vi.fn().mockRejectedValue(new Error('NUTRITION_NOT_ENTITLED'));
    await runInitialNutritionRequest('a', request); await runInitialNutritionRequest('a', request);
    expect(request).toHaveBeenCalledTimes(1);
    expect((await readInitialNutritionRequest('a')).status).toBe('failed');
    expect((await readInitialNutritionRequest('b')).attempts).toBe(0);
  });
  it('reserves before request, blocks concurrent requests and resumes expired crash reservations', async () => {
    vi.useFakeTimers();
    let finish!: (value: { generationId: string }) => void;
    const request = vi.fn(() => new Promise<{ generationId: string }>((resolve) => { finish = resolve; }));
    const first = runInitialNutritionRequest('u', request);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await runInitialNutritionRequest('u', request); expect(request).toHaveBeenCalledTimes(1);
    finish({ generationId: 'job' }); await first;
    await runInitialNutritionRequest('u', request); expect(request).toHaveBeenCalledTimes(1);
    store.set('ajfit.initial-nutrition-request.v1:crash', JSON.stringify({ status: 'requesting', attempts: 1, nextAt: Date.now() - 1 }));
    await runInitialNutritionRequest('crash', async () => ({ generationId: 'same-job' }));
    expect((await readInitialNutritionRequest('crash')).status).toBe('queued');
  });
  it('keeps a disabled flag recoverable without spending an attempt', async () => {
    await setInitialNutritionDisabled('u'); expect(await readInitialNutritionRequest('u')).toMatchObject({ status: 'disabled', attempts: 0 });
    await runInitialNutritionRequest('u', async () => ({ generationId: '', status: 'disabled' }));
    expect((await readInitialNutritionRequest('u')).status).toBe('disabled');
  });
});

describe('initial pending has a real, recoverable presentation without inventing a job', () => {
  it('shows disabled without blocking manual generation, or disables retries when general rollout is off', () => {
    expect(resolveInitialNutritionRequestPresentation({ status: 'disabled', attempts: 0, nextAt: 0 }, true, true)).toEqual({ kind: 'disabled', canRetry: true });
    expect(resolveInitialNutritionRequestPresentation(null, false, true)).toEqual({ kind: 'disabled', canRetry: false });
  });
  it.each(['failed', 'exhausted'] as const)('shows a stopped %s request with explicit recovery', (status) => {
    expect(resolveInitialNutritionRequestPresentation({ status, attempts: 3, nextAt: 0 }, true, true)).toEqual({ kind: 'failed', canRetry: true });
  });
  it('does not offer another request during a valid reservation and resolves its crashed expiry', () => {
    expect(resolveInitialNutritionRequestPresentation({ status: 'requesting', attempts: 3, nextAt: 200 }, true, true, 100)).toEqual({ kind: 'waiting', canRetry: false });
    expect(resolveInitialNutritionRequestPresentation({ status: 'requesting', attempts: 3, nextAt: 200 }, true, true, 300)).toEqual({ kind: 'failed', canRetry: true });
    expect(resolveInitialNutritionRequestPresentation(null, true, false).canRetry).toBe(false);
  });
});
