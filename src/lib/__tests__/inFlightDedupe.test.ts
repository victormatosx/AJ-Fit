import { describe, expect, it, vi } from 'vitest';
import { createInFlightDedupe } from '../inFlightDedupe';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createInFlightDedupe', () => {
  it('collapses concurrent calls for the same key into one real attempt, all callers get the same result', async () => {
    const attempt = vi.fn();
    const dedupe = createInFlightDedupe<string>();
    const first = deferred<string>();
    attempt.mockReturnValueOnce(first.promise);

    const [a, b, c] = [
      dedupe('uid-A', attempt),
      dedupe('uid-A', attempt),
      dedupe('uid-A', attempt),
    ];
    expect(attempt).toHaveBeenCalledTimes(1);
    first.resolve('bundle-1');

    await expect(a).resolves.toBe('bundle-1');
    await expect(b).resolves.toBe('bundle-1');
    await expect(c).resolves.toBe('bundle-1');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('starts a genuinely new attempt once the previous call for that key has settled', async () => {
    const attempt = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    const dedupe = createInFlightDedupe<string>();

    await expect(dedupe('uid-A', attempt)).resolves.toBe('first');
    await expect(dedupe('uid-A', attempt)).resolves.toBe('second');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight entry on failure so the next call retries instead of rejecting from cache', async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered');
    const dedupe = createInFlightDedupe<string>();

    await expect(dedupe('uid-A', attempt)).rejects.toThrow('boom');
    await expect(dedupe('uid-A', attempt)).resolves.toBe('recovered');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('never shares an in-flight promise across different keys', async () => {
    const attemptA = vi.fn().mockResolvedValue('bundle-A');
    const attemptB = vi.fn().mockResolvedValue('bundle-B');
    const dedupe = createInFlightDedupe<string>();

    const [a, b] = await Promise.all([
      dedupe('uid-A', attemptA),
      dedupe('uid-B', attemptB),
    ]);
    expect(a).toBe('bundle-A');
    expect(b).toBe('bundle-B');
    expect(attemptA).toHaveBeenCalledTimes(1);
    expect(attemptB).toHaveBeenCalledTimes(1);
  });
});
