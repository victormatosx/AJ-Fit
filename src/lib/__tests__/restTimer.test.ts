import { describe, expect, it, vi } from 'vitest';
import {
  IDLE_REST_TIMER_STATE,
  addRestSeconds,
  cancelRestTransition,
  computeRemainingSeconds,
  computeRestProgress,
  consumeExpiredRest,
  createRest,
  ensureWorkoutSessionId,
  isRestExpired,
  parseActiveRest,
  reconcileRestExpiration,
  type ActiveRest,
  type RestTimerState,
} from '../restTimer';

const BASE_REST: ActiveRest = createRest({
  restId: 'rest-1',
  workoutSessionId: 'session-1',
  startedAt: 100_000,
  durationSeconds: 90,
  exerciseId: 'supino-reto',
  setIndex: 0,
  totalSets: 4,
});

describe('absolute rest time', () => {
  it('creates a 90s rest from epoch milliseconds', () => {
    expect(BASE_REST.startedAt).toBe(100_000);
    expect(BASE_REST.endsAt).toBe(190_000);
    expect(BASE_REST.initialDurationSeconds).toBe(90);
  });

  it('derives remaining seconds from endsAt', () => {
    expect(computeRemainingSeconds(BASE_REST, 145_000)).toBe(45);
  });

  it('marks now >= endsAt as expired and clamps remaining at zero', () => {
    expect(isRestExpired(BASE_REST, 190_000)).toBe(true);
    expect(isRestExpired(BASE_REST, 191_000)).toBe(true);
    expect(computeRemainingSeconds(BASE_REST, 250_000)).toBe(0);
  });

  it('corrects a delayed tick by the full elapsed time instead of decrementing once', () => {
    expect(computeRemainingSeconds(BASE_REST, 101_000)).toBe(89);
    expect(computeRemainingSeconds(BASE_REST, 111_000)).toBe(79);
  });

  it('extends endsAt by 15s without resetting startedAt or session identity', () => {
    const extended = addRestSeconds(BASE_REST, 15);
    expect(extended.endsAt).toBe(205_000);
    expect(extended.startedAt).toBe(BASE_REST.startedAt);
    expect(extended.workoutSessionId).toBe(BASE_REST.workoutSessionId);
    expect(extended.restId).toBe(BASE_REST.restId);
  });

  it('supports multiple +15s extensions consistently', () => {
    const extended = addRestSeconds(
      addRestSeconds(addRestSeconds(BASE_REST, 15), 15),
      15,
    );
    expect(extended.endsAt).toBe(235_000);
    expect(extended.startedAt).toBe(BASE_REST.startedAt);
    expect(extended.restId).toBe(BASE_REST.restId);
    expect(extended.workoutSessionId).toBe(BASE_REST.workoutSessionId);
    expect(computeRemainingSeconds(extended, 145_000)).toBe(90);
  });

  it.each([0, 50_000, 100_000, 145_000, 190_000, 250_000])(
    'clamps progress to [0, 1] at now=%i',
    (now) => {
      const progress = computeRestProgress(BASE_REST, now);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    },
  );

  it('uses the extended effective duration for progress', () => {
    const extended = addRestSeconds(BASE_REST, 15);
    expect(computeRestProgress(extended, extended.startedAt)).toBe(1);
    expect(computeRestProgress(extended, extended.endsAt)).toBe(0);
  });
});

describe('workout session identity', () => {
  it('creates the id once and keeps it stable across rests', () => {
    const createId = vi.fn(() => 'session-stable');
    const first = ensureWorkoutSessionId(null, createId);
    const second = ensureWorkoutSessionId(first, createId);
    const restA = { ...BASE_REST, workoutSessionId: first };
    const restB = createRest({
      restId: 'rest-2',
      workoutSessionId: second,
      startedAt: 250_000,
      durationSeconds: 60,
      exerciseId: 'supino-incl',
      setIndex: 1,
      totalSets: 3,
    });

    expect(createId).toHaveBeenCalledTimes(1);
    expect(restA.workoutSessionId).toBe(restB.workoutSessionId);
  });
});

describe('exactly-once rest completion', () => {
  it('allows only one consumer across duplicate expiry triggers', () => {
    const running: RestTimerState = { status: 'running', rest: BASE_REST };
    const fromTimer = reconcileRestExpiration(running, BASE_REST.endsAt);
    const fromForeground = reconcileRestExpiration(fromTimer, BASE_REST.endsAt + 10_000);
    expect(fromForeground).toBe(fromTimer);

    const first = consumeExpiredRest(fromForeground, BASE_REST.restId);
    const second = consumeExpiredRest(first.state, BASE_REST.restId);
    expect(first.consumed).toBe(true);
    expect(first.state).toBe(IDLE_REST_TIMER_STATE);
    expect(second.consumed).toBe(false);
  });

  it('lets skip claim the transition before a later timer expiry', () => {
    const running: RestTimerState = { status: 'running', rest: BASE_REST };
    const skipped = cancelRestTransition(running, BASE_REST.restId);
    const lateTimer = reconcileRestExpiration(skipped.state, BASE_REST.endsAt + 1);

    expect(skipped.consumed).toBe(true);
    expect(lateTimer).toBe(IDLE_REST_TIMER_STATE);
    expect(consumeExpiredRest(lateTimer, BASE_REST.restId).consumed).toBe(false);
  });
});

describe('persisted rest validation', () => {
  it('accepts the complete domain model and rejects malformed or impossible data', () => {
    expect(parseActiveRest(BASE_REST)).toEqual(BASE_REST);
    expect(parseActiveRest(null)).toBeNull();
    expect(parseActiveRest({ ...BASE_REST, endsAt: BASE_REST.startedAt })).toBeNull();
    expect(parseActiveRest({ ...BASE_REST, setIndex: BASE_REST.totalSets })).toBeNull();
    expect(parseActiveRest({ ...BASE_REST, workoutSessionId: '' })).toBeNull();
  });
});
