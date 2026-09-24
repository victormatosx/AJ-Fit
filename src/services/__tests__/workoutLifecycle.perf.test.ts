import { describe, expect, it } from 'vitest';

describe('loadWorkoutLifecycle Firestore read counting', () => {
  it('counts one bundle read per call via the shared perf counter', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/workoutLifecycle.ts', 'utf8');
    expect(source).toContain("from '../lib/perf'");
    expect(source).toContain("countFirestoreRead('workout_lifecycle.bundle')");
  });
});
