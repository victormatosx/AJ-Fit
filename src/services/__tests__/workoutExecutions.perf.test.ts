import { describe, expect, it } from 'vitest';

describe('workoutExecutions range query read counting', () => {
  it('counts the shared range query used by both the week and 30-day windows', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/workoutExecutions.ts', 'utf8');
    expect(source).toContain("from '../lib/perf'");
    expect(source).toContain("countFirestoreRead('workout_executions.range_query')");
  });
});
