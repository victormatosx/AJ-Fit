import { describe, expect, it, vi } from 'vitest';
import { withFoodLogSearchTimeout } from '../searchTimeout';

describe('withFoodLogSearchTimeout', () => {
  it('returns a normal result and clears the timer', async () => {
    await expect(withFoodLogSearchTimeout(Promise.resolve('ok'), 10)).resolves.toBe('ok');
  });

  it('rejects a stalled request so the UI cannot spin indefinitely', async () => {
    vi.useFakeTimers();
    const stalled = withFoodLogSearchTimeout(new Promise<string>(() => undefined), 10);
    const assertion = expect(stalled).rejects.toThrow('CATALOG_SEARCH_TIMEOUT');
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    vi.useRealTimers();
  });
});
