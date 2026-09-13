import { describe, expect, it } from 'vitest';
import {
  MAX_CARDIO_TARGET_SECONDS,
  cardioProgressRatio,
  computeCardioElapsedSeconds,
  createCardioSession,
  crossedCardioTarget,
  extendCardioTarget,
  finishCardio,
  formatCardioClock,
  parseCardioSession,
  parsePrescribedCardioDurationSeconds,
  pauseCardio,
  remainingCardioSeconds,
  startCardio,
  resumeCardio,
  type CardioSession,
} from '../cardioTimer';

const BASE_INPUT = {
  cardioSessionId: 'cardio-1',
  workoutSessionId: 'exec-1',
  plannedDurationSeconds: 1200, // 20 min
};

describe('createCardioSession — initial state', () => {
  it('starts READY with elapsed 0 and target equal to the plan', () => {
    const session = createCardioSession(BASE_INPUT);
    expect(session.status).toBe('READY');
    expect(session.cardioStartedAt).toBeNull();
    expect(session.targetDurationSeconds).toBe(1200);
    expect(computeCardioElapsedSeconds(session, 999_999)).toBe(0);
  });
});

describe('startCardio', () => {
  it('transitions to RUNNING and records the start instant', () => {
    const session = startCardio(createCardioSession(BASE_INPUT), 10_000);
    expect(session.status).toBe('RUNNING');
    expect(session.cardioStartedAt).toBe(10_000);
  });

  it('is a no-op once already RUNNING or FINISHED', () => {
    const running = startCardio(createCardioSession(BASE_INPUT), 10_000);
    const restarted = startCardio(running, 99_999);
    expect(restarted).toBe(running);

    const finished = finishCardio(running, 20_000);
    const restartedAfterFinish = startCardio(finished, 123_456);
    expect(restartedAfterFinish).toBe(finished);
  });
});

describe('computeCardioElapsedSeconds — wall clock, not a tick count', () => {
  it('start = 10:00, now = 10:10 -> elapsed = 600s regardless of intermediate ticks', () => {
    const start = 10 * 60 * 60 * 1000;
    const session = startCardio(createCardioSession(BASE_INPUT), start);
    expect(computeCardioElapsedSeconds(session, start + 10 * 60_000)).toBe(600);
  });

  it('large background gap: start = 10:00, now = 10:20 -> elapsed = 1200s', () => {
    const start = 10 * 60 * 60 * 1000;
    const session = startCardio(createCardioSession(BASE_INPUT), start);
    expect(computeCardioElapsedSeconds(session, start + 20 * 60_000)).toBe(1200);
  });

  it('freezes at actualDurationSeconds once FINISHED', () => {
    const session = startCardio(createCardioSession(BASE_INPUT), 0);
    const finished = finishCardio(session, 90_000);
    expect(computeCardioElapsedSeconds(finished, 999_000)).toBe(90);
  });
});

describe('pauseCardio / resumeCardio', () => {
  it('freezes while paused and excludes the paused wall time after resume', () => {
    const running = startCardio(createCardioSession(BASE_INPUT), 10_000);
    const paused = pauseCardio(running, 70_000);
    expect(paused.status).toBe('PAUSED');
    expect(computeCardioElapsedSeconds(paused, 370_000)).toBe(60);

    const resumed = resumeCardio(paused, 370_000);
    expect(resumed.status).toBe('RUNNING');
    expect(resumed.accumulatedPausedMs).toBe(300_000);
    expect(computeCardioElapsedSeconds(resumed, 400_000)).toBe(90);
  });

  it('finishes a paused session at its frozen elapsed duration', () => {
    const running = startCardio(createCardioSession(BASE_INPUT), 0);
    const paused = pauseCardio(running, 90_000);
    const finished = finishCardio(paused, 500_000);
    expect(finished.actualDurationSeconds).toBe(90);
  });
});

describe('target / remaining / progress', () => {
  it('target reached exactly at elapsed === target', () => {
    expect(remainingCardioSeconds(1200, 1200)).toBe(0);
    expect(cardioProgressRatio(1200, 1200)).toBe(1);
  });

  it('over target: elapsed keeps growing, remaining clamps at 0, progress clamps at 1', () => {
    expect(remainingCardioSeconds(1500, 1200)).toBe(0);
    expect(cardioProgressRatio(1500, 1200)).toBe(1);
  });

  it('under target: partial remaining/progress', () => {
    expect(remainingCardioSeconds(900, 1200)).toBe(300);
    expect(cardioProgressRatio(900, 1200)).toBeCloseTo(0.75);
  });
});

describe('extendCardioTarget (+5 min)', () => {
  it('before the goal: target 20 + 5 -> 25, remaining 7 at elapsed 18', () => {
    const session = { ...startCardio(createCardioSession(BASE_INPUT), 0) };
    const extended = extendCardioTarget(session, 300);
    expect(extended.targetDurationSeconds).toBe(1500);
    expect(remainingCardioSeconds(18 * 60, extended.targetDurationSeconds)).toBe(7 * 60);
  });

  it('after the goal: target 20 + 5 -> 25, remaining 3 at elapsed 22', () => {
    const session = startCardio(createCardioSession(BASE_INPUT), 0);
    const extended = extendCardioTarget(session, 300);
    expect(extended.targetDurationSeconds).toBe(1500);
    expect(remainingCardioSeconds(22 * 60, extended.targetDurationSeconds)).toBe(3 * 60);
  });

  it('never mutates cardioStartedAt or elapsed', () => {
    const session = startCardio(createCardioSession(BASE_INPUT), 5_000);
    const extended = extendCardioTarget(session, 300);
    expect(extended.cardioStartedAt).toBe(5_000);
  });

  it('can be applied repeatedly: 20 -> 25 -> 30 -> 35', () => {
    let session = startCardio(createCardioSession(BASE_INPUT), 0);
    session = extendCardioTarget(session, 300);
    session = extendCardioTarget(session, 300);
    session = extendCardioTarget(session, 300);
    expect(session.targetDurationSeconds).toBe(2100);
  });

  it('is a no-op while READY or FINISHED', () => {
    const ready = createCardioSession(BASE_INPUT);
    expect(extendCardioTarget(ready, 300)).toBe(ready);

    const finished = finishCardio(startCardio(createCardioSession(BASE_INPUT), 0), 60_000);
    expect(extendCardioTarget(finished, 300)).toBe(finished);
  });

  it('caps at MAX_CARDIO_TARGET_SECONDS against runaway taps', () => {
    let session = startCardio(createCardioSession(BASE_INPUT), 0);
    for (let i = 0; i < 200; i += 1) session = extendCardioTarget(session, 300);
    expect(session.targetDurationSeconds).toBeLessThanOrEqual(MAX_CARDIO_TARGET_SECONDS);
  });
});

describe('finishCardio', () => {
  it('before the goal: preserves the real elapsed, does not force it up to target', () => {
    const session = startCardio(createCardioSession(BASE_INPUT), 0);
    const finished = finishCardio(session, 12 * 60_000);
    expect(finished.actualDurationSeconds).toBe(12 * 60);
    expect(finished.status).toBe('FINISHED');
  });

  it('after the goal: preserves actual > target instead of clamping to 20', () => {
    const session = startCardio(createCardioSession(BASE_INPUT), 0);
    const finished = finishCardio(session, 27 * 60_000);
    expect(finished.actualDurationSeconds).toBe(27 * 60);
    expect(finished.plannedDurationSeconds).toBe(1200);
  });

  it('elapsed stops growing once finished', () => {
    const session = startCardio(createCardioSession(BASE_INPUT), 0);
    const finished = finishCardio(session, 10 * 60_000);
    expect(computeCardioElapsedSeconds(finished, 999 * 60_000)).toBe(10 * 60);
  });
});

describe('crossedCardioTarget — feedback fires exactly once per goal', () => {
  it('fires when elapsed crosses the target between two ticks', () => {
    expect(crossedCardioTarget(1199, 1200, 1200)).toBe(true);
  });

  it('does not fire again on subsequent ticks while still >= target', () => {
    expect(crossedCardioTarget(1200, 1201, 1200)).toBe(false);
    expect(crossedCardioTarget(1300, 1301, 1200)).toBe(false);
  });

  it('re-arms after the target is raised via +5 min', () => {
    // Reached 20 min, then extended to 25 — the same elapsed value must not
    // immediately re-report a crossing against the new target...
    expect(crossedCardioTarget(1200, 1200, 1500)).toBe(false);
    // ...but crossing 25 min afterward fires again.
    expect(crossedCardioTarget(1499, 1500, 1500)).toBe(true);
  });
});

describe('parsePrescribedCardioDurationSeconds', () => {
  it('parses a single value', () => {
    expect(parsePrescribedCardioDurationSeconds('20 min')).toBe(1200);
  });

  it('parses a range using its upper bound', () => {
    expect(parsePrescribedCardioDurationSeconds('10-20 min')).toBe(1200);
    expect(parsePrescribedCardioDurationSeconds('5-12 min')).toBe(720);
    expect(parsePrescribedCardioDurationSeconds('8-15 min')).toBe(900);
  });

  it('falls back to a sane default for malformed input', () => {
    expect(parsePrescribedCardioDurationSeconds('')).toBeGreaterThan(0);
    expect(parsePrescribedCardioDurationSeconds('n/a')).toBeGreaterThan(0);
  });
});

describe('formatCardioClock', () => {
  it.each([
    [0, '0:00'],
    [277, '4:37'],
    [1199, '19:59'],
    [1200, '20:00'],
    [3792, '1:03:12'],
  ])('formats %i seconds as %s', (seconds, expected) => {
    expect(formatCardioClock(seconds)).toBe(expected);
  });
});

describe('parseCardioSession — restore/remount', () => {
  it('round-trips a RUNNING session through JSON without zeroing the clock', () => {
    const session = startCardio(createCardioSession(BASE_INPUT), 42_000);
    const restored = parseCardioSession(JSON.parse(JSON.stringify(session)));
    expect(restored).toEqual(session);
  });

  it('round-trips a PAUSED session and migrates legacy sessions with pause defaults', () => {
    const paused = pauseCardio(startCardio(createCardioSession(BASE_INPUT), 0), 30_000);
    expect(parseCardioSession(JSON.parse(JSON.stringify(paused)))).toEqual(paused);

    const legacy = { ...startCardio(createCardioSession(BASE_INPUT), 0) } as Record<string, unknown>;
    delete legacy.cardioPausedAt;
    delete legacy.accumulatedPausedMs;
    expect(parseCardioSession(legacy)).toMatchObject({
      cardioPausedAt: null,
      accumulatedPausedMs: 0,
    });
  });

  it('rejects malformed/garbage input', () => {
    expect(parseCardioSession(null)).toBeNull();
    expect(parseCardioSession({})).toBeNull();
    expect(parseCardioSession({ ...createCardioSession(BASE_INPUT), status: 'BOGUS' })).toBeNull();
  });

  it('rejects a RUNNING session with a null cardioStartedAt', () => {
    const invalid: unknown = { ...createCardioSession(BASE_INPUT), status: 'RUNNING', cardioStartedAt: null };
    expect(parseCardioSession(invalid)).toBeNull();
  });

  it('regression: never falls back to a tick-based counter for elapsed time', () => {
    // If elapsed were `ticks * 1`, a large now-jump (background/lock) would
    // under-report time. Assert the full jump is reflected in one read.
    const session: CardioSession = startCardio(createCardioSession(BASE_INPUT), 0);
    const afterOneTick = computeCardioElapsedSeconds(session, 1_000);
    const afterBigGap = computeCardioElapsedSeconds(session, 20 * 60_000);
    expect(afterOneTick).toBe(1);
    expect(afterBigGap).toBe(1200);
  });
});
