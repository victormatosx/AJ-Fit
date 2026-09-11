import { describe, expect, it } from 'vitest';
import {
  FOREGROUND_RECONCILE_THROTTLE_MS,
  shouldReconcileOnForeground,
  type ForegroundReconcileGuardInput,
} from '../foregroundReconcile';

function baseInput(overrides: Partial<ForegroundReconcileGuardInput> = {}): ForegroundReconcileGuardInput {
  return {
    previousState: 'background',
    nextState: 'active',
    hasLoadedOnce: true,
    reconcileInFlight: false,
    now: 1_000_000,
    lastForegroundReconcileAtMs: null,
    ...overrides,
  };
}

describe('shouldReconcileOnForeground', () => {
  it('reconciles on a real background -> active resume', () => {
    expect(shouldReconcileOnForeground(baseInput({ previousState: 'background', nextState: 'active' }))).toBe(true);
  });

  it('reconciles on a real inactive -> active resume', () => {
    expect(shouldReconcileOnForeground(baseInput({ previousState: 'inactive', nextState: 'active' }))).toBe(true);
  });

  it('never reconciles on an active -> active no-op event', () => {
    expect(shouldReconcileOnForeground(baseInput({ previousState: 'active', nextState: 'active' }))).toBe(false);
  });

  it('never reconciles when the app is leaving foreground (active -> background/inactive)', () => {
    expect(shouldReconcileOnForeground(baseInput({ previousState: 'active', nextState: 'background' }))).toBe(false);
    expect(shouldReconcileOnForeground(baseInput({ previousState: 'active', nextState: 'inactive' }))).toBe(false);
  });

  it('never reconciles background -> inactive (still not foreground)', () => {
    expect(shouldReconcileOnForeground(baseInput({ previousState: 'background', nextState: 'inactive' }))).toBe(false);
  });

  it('defers to COLD_START on the very first load — never double-reconciles the initial mount', () => {
    expect(shouldReconcileOnForeground(baseInput({ hasLoadedOnce: false }))).toBe(false);
  });

  it('never overlaps a reconcile already in flight (COLD_START, POST_WORKOUT refresh, or a previous FOREGROUND)', () => {
    expect(shouldReconcileOnForeground(baseInput({ reconcileInFlight: true }))).toBe(false);
  });

  it('throttles a second resume that arrives inside the throttle window', () => {
    const lastAt = 1_000_000;
    const tooSoon = lastAt + FOREGROUND_RECONCILE_THROTTLE_MS - 1;
    expect(shouldReconcileOnForeground(baseInput({
      now: tooSoon,
      lastForegroundReconcileAtMs: lastAt,
    }))).toBe(false);
  });

  it('allows a new resume once the throttle window has elapsed', () => {
    const lastAt = 1_000_000;
    const justAfter = lastAt + FOREGROUND_RECONCILE_THROTTLE_MS;
    expect(shouldReconcileOnForeground(baseInput({
      now: justAfter,
      lastForegroundReconcileAtMs: lastAt,
    }))).toBe(true);
  });

  it('respects a custom throttleMs override', () => {
    const lastAt = 1_000_000;
    expect(shouldReconcileOnForeground(baseInput({
      now: lastAt + 100,
      lastForegroundReconcileAtMs: lastAt,
      throttleMs: 50,
    }))).toBe(true);
    expect(shouldReconcileOnForeground(baseInput({
      now: lastAt + 10,
      lastForegroundReconcileAtMs: lastAt,
      throttleMs: 50,
    }))).toBe(false);
  });

  it('skips the throttle when recovering from ERROR — a resume inside the cooldown window still reconciles', () => {
    const lastAt = 1_000_000;
    const tooSoon = lastAt + FOREGROUND_RECONCILE_THROTTLE_MS - 1;
    expect(shouldReconcileOnForeground(baseInput({
      now: tooSoon,
      lastForegroundReconcileAtMs: lastAt,
      isRecoveringFromError: true,
    }))).toBe(true);
  });

  it('ERROR recovery still respects the real-resume/in-flight/cold-start guards — it only skips the time cooldown', () => {
    expect(shouldReconcileOnForeground(baseInput({ previousState: 'active', nextState: 'active', isRecoveringFromError: true }))).toBe(false);
    expect(shouldReconcileOnForeground(baseInput({ reconcileInFlight: true, isRecoveringFromError: true }))).toBe(false);
    expect(shouldReconcileOnForeground(baseInput({ hasLoadedOnce: false, isRecoveringFromError: true }))).toBe(false);
  });

  it('a healthy (non-ERROR) state keeps being throttled normally', () => {
    const lastAt = 1_000_000;
    const tooSoon = lastAt + FOREGROUND_RECONCILE_THROTTLE_MS - 1;
    expect(shouldReconcileOnForeground(baseInput({
      now: tooSoon,
      lastForegroundReconcileAtMs: lastAt,
      isRecoveringFromError: false,
    }))).toBe(false);
  });

  it('event storm: only the first real resume in a rapid sequence reconciles', () => {
    // active -> inactive -> active -> background -> active, all within one
    // throttle window — simulates a fast app-switcher fling.
    let previous: ForegroundReconcileGuardInput['previousState'] = 'active';
    let lastReconcileAt: number | null = null;
    const transitions: { next: ForegroundReconcileGuardInput['nextState']; atMs: number }[] = [
      { next: 'inactive', atMs: 0 },
      { next: 'active', atMs: 10 },
      { next: 'background', atMs: 20 },
      { next: 'active', atMs: 30 },
    ];
    let reconcileCount = 0;
    for (const transition of transitions) {
      const decision = shouldReconcileOnForeground({
        previousState: previous,
        nextState: transition.next,
        hasLoadedOnce: true,
        reconcileInFlight: false,
        now: transition.atMs,
        lastForegroundReconcileAtMs: lastReconcileAt,
      });
      if (decision) {
        reconcileCount += 1;
        lastReconcileAt = transition.atMs;
      }
      previous = transition.next;
    }
    expect(reconcileCount).toBe(1);
  });
});
