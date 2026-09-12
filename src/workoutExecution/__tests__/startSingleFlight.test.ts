import { describe, expect, it, vi } from 'vitest';
import { beginWorkoutStartFlight, type WorkoutStartFlight } from '../startSingleFlight';

describe('workout start single-flight lifecycle', () => {
  it('fully releases a synchronously rejected offline attempt so reconnect can start the same session', async () => {
    const ref: { current: WorkoutStartFlight<string> | null } = { current: null };
    const key = 'alice:program:0:2026-09-12';

    const offline = beginWorkoutStartFlight(ref, key, () => {
      throw new Error('unavailable');
    });
    expect(offline.kind).toBe('started');
    if (offline.kind === 'busy') throw new Error('unexpected busy result');
    await expect(offline.promise).rejects.toThrow('unavailable');
    expect(ref.current).toBeNull();

    const online = beginWorkoutStartFlight(ref, key, async () => 'IN_PROGRESS');
    expect(online.kind).toBe('started');
    if (online.kind === 'busy') throw new Error('unexpected busy result');
    await expect(online.promise).resolves.toBe('IN_PROGRESS');
    expect(ref.current).toBeNull();
  });

  it('reuses exactly one promise while the real attempt is active', async () => {
    const ref: { current: WorkoutStartFlight<string> | null } = { current: null };
    let finish!: (value: string) => void;
    const task = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));

    const first = beginWorkoutStartFlight(ref, 'same-session', task);
    const doubleTap = beginWorkoutStartFlight(ref, 'same-session', task);
    expect(first.kind).toBe('started');
    expect(doubleTap.kind).toBe('reused');
    if (first.kind === 'busy' || doubleTap.kind === 'busy') throw new Error('unexpected busy result');
    expect(doubleTap.promise).toBe(first.promise);

    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
    finish('IN_PROGRESS');
    await expect(first.promise).resolves.toBe('IN_PROGRESS');
    expect(ref.current).toBeNull();
  });
});
