import { describe, expect, it } from 'vitest';

import { deriveSessionMuscles } from '../sessionMuscles';

describe('deriveSessionMuscles', () => {
  it('returns empty primary/secondary for an empty session', () => {
    expect(deriveSessionMuscles([])).toEqual({ primary: [], secondary: [] });
  });

  it('collects primary and secondary muscles from a single exercise', () => {
    const result = deriveSessionMuscles(['incline-dumbbell-bench-press']);
    expect(result.primary).toEqual(['chest']);
    expect(result.secondary.sort()).toEqual(['front_deltoid', 'triceps']);
  });

  it('dedupes muscles repeated across exercises', () => {
    const result = deriveSessionMuscles(['incline-dumbbell-bench-press', 'incline-dumbbell-bench-press']);
    expect(result.primary).toEqual(['chest']);
    expect(result.secondary.sort()).toEqual(['front_deltoid', 'triceps']);
  });

  it('lets primary win when a muscle is primary in one exercise and secondary in another', () => {
    // incline-dumbbell-bench-press: primary chest, secondary [front_deltoid, triceps]
    // bench-dips: primary triceps, secondary [front_deltoid, chest]
    const result = deriveSessionMuscles(['incline-dumbbell-bench-press', 'bench-dips']);
    expect(result.primary.sort()).toEqual(['chest', 'triceps']);
    expect(result.secondary).toEqual(['front_deltoid']);
    // A muscle never appears in both arrays.
    for (const muscle of result.primary) expect(result.secondary).not.toContain(muscle);
  });

  it('is independent of input order (primary still wins)', () => {
    const forward = deriveSessionMuscles(['incline-dumbbell-bench-press', 'bench-dips']);
    const reversed = deriveSessionMuscles(['bench-dips', 'incline-dumbbell-bench-press']);
    expect(forward.primary.sort()).toEqual(reversed.primary.sort());
    expect(forward.secondary.sort()).toEqual(reversed.secondary.sort());
  });

  it('skips exercise ids that do not resolve to a catalog target', () => {
    const result = deriveSessionMuscles(['not-a-real-exercise-id']);
    expect(result).toEqual({ primary: [], secondary: [] });
  });

  it('handles a mix of resolvable and unresolvable ids without throwing', () => {
    const result = deriveSessionMuscles(['incline-dumbbell-bench-press', 'not-a-real-exercise-id']);
    expect(result.primary).toEqual(['chest']);
  });

  it('handles a realistic multi-exercise session with several muscles', () => {
    const result = deriveSessionMuscles([
      'lat-pulldown-supinated-grip', // primary lats, secondary [biceps, rear_deltoid]
      'incline-dumbbell-bench-press', // primary chest, secondary [front_deltoid, triceps]
      'seated-hip-adductor-machine', // primary adductors, secondary []
    ]);
    expect(result.primary.sort()).toEqual(['chest', 'lats', 'adductors'].sort());
    expect(result.secondary.sort()).toEqual(['biceps', 'front_deltoid', 'rear_deltoid', 'triceps'].sort());
  });
});
