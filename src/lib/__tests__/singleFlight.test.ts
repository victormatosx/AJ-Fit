import { describe, expect, it, vi } from 'vitest';
import { createSingleFlight } from '../singleFlight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

describe('single-flight async barrier', () => {
  it('turns 20 concurrent calls into one complete signup workflow', async () => {
    const gate = createSingleFlight<void>();
    const creation = deferred<void>();
    const effects = {
      createFirebaseUser: vi.fn(() => creation.promise),
      loadState: vi.fn(async () => undefined),
      provisionProfile: vi.fn(async () => undefined),
      sendVerification: vi.fn(async () => undefined),
    };
    const workflow = async () => {
      await effects.createFirebaseUser();
      await effects.sendVerification();
      await effects.provisionProfile();
      await effects.loadState();
    };

    const calls = Array.from({ length: 20 }, () => gate.run(workflow));
    await Promise.resolve();

    expect(effects.createFirebaseUser).toHaveBeenCalledTimes(1);
    expect(gate.isRunning()).toBe(true);

    creation.resolve();
    await Promise.all(calls);

    expect(effects.sendVerification).toHaveBeenCalledTimes(1);
    expect(effects.provisionProfile).toHaveBeenCalledTimes(1);
    expect(effects.loadState).toHaveBeenCalledTimes(1);
    expect(gate.isRunning()).toBe(false);
  });

  it('releases after success so a future operation can run', async () => {
    const gate = createSingleFlight<void>();
    const operation = vi.fn(async () => undefined);

    await gate.run(operation);
    await gate.run(operation);

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it.each(['error', 'cancel'] as const)(
    'releases after %s so a future operation can run',
    async (kind) => {
      const gate = createSingleFlight<void>();
      const failure = new Error(kind);
      const operation = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(undefined);

      await expect(gate.run(operation)).rejects.toBe(failure);
      await expect(gate.run(operation)).resolves.toBeUndefined();

      expect(operation).toHaveBeenCalledTimes(2);
      expect(gate.isRunning()).toBe(false);
    },
  );

  it('shares a pending rejection with every waiter and never leaves a stuck lock', async () => {
    const gate = createSingleFlight<void>();
    const pending = deferred<void>();
    const operation = vi.fn(() => pending.promise);
    const calls = Array.from({ length: 20 }, () => gate.run(operation));
    const failure = new Error('slow failure');

    await Promise.resolve();
    pending.reject(failure);
    const outcomes = await Promise.allSettled(calls);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(20);
    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
    expect(gate.isRunning()).toBe(false);
  });
});
