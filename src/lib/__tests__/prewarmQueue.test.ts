import { describe, expect, it } from 'vitest';
import { nextPrewarmRoute, withCompletedRoute } from '../prewarmQueue';

const ORDER = ['A', 'B', 'C'] as const;

describe('nextPrewarmRoute', () => {
  it('returns the first id when nothing is completed', () => {
    expect(nextPrewarmRoute(ORDER, new Set<string>())).toBe('A');
  });

  it('returns the next id in order, not just any incomplete one', () => {
    expect(nextPrewarmRoute(ORDER, new Set(['A']))).toBe('B');
  });

  it('returns null once every id is completed — the queue stops scheduling', () => {
    expect(nextPrewarmRoute(ORDER, new Set(['A', 'B', 'C']))).toBeNull();
  });

  it('skips completed ids out of order but still respects sequence for the rest', () => {
    // Defensive: even if completion arrived out of the declared order, the
    // next pick is still the first *declared* id not yet done.
    expect(nextPrewarmRoute(ORDER, new Set(['B']))).toBe('A');
  });
});

describe('withCompletedRoute', () => {
  it('adds an id to the completed set', () => {
    const result = withCompletedRoute(new Set<string>(), 'A');
    expect(result.has('A')).toBe(true);
  });

  it('preserves referential identity when the id is already completed (no redundant re-render)', () => {
    const completed = new Set(['A']);
    expect(withCompletedRoute(completed, 'A')).toBe(completed);
  });

  it('proves the full queue drains in order: A -> B -> C -> done', () => {
    let completed: ReadonlySet<string> = new Set<string>();
    expect(nextPrewarmRoute(ORDER, completed)).toBe('A');
    completed = withCompletedRoute(completed, 'A');
    expect(nextPrewarmRoute(ORDER, completed)).toBe('B');
    completed = withCompletedRoute(completed, 'B');
    expect(nextPrewarmRoute(ORDER, completed)).toBe('C');
    completed = withCompletedRoute(completed, 'C');
    expect(nextPrewarmRoute(ORDER, completed)).toBeNull();
  });
});
