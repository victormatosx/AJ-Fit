import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');

/**
 * `WorkoutScreen.tsx` cannot be rendered in this project's test suite (no
 * React Native test renderer — `vitest.config.mts` only collects `.test.ts`
 * in a Node environment). This locks the one behavioral invariant Phase 2
 * Part D explicitly required auditing textually: the LAST set of the WHOLE
 * workout must skip the rest screen entirely, not open a useless
 * post-finish countdown — pre-existing behavior, confirmed unchanged by
 * this phase's `restSeconds` wiring.
 */
describe('WorkoutScreen.completeSet — last set of the whole workout never opens a rest screen (structural)', () => {
  it('(13) `isLastOverall` short-circuits to `setFinished(true)` before starting a rest', () => {
    const fnStart = source.indexOf('const completeSet = () => {');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = source.slice(fnStart, source.indexOf('const skipRest = () => {', fnStart));

    const isLastOverallCheck = fnBody.indexOf('if (isLastOverall)');
    const setFinishedCall = fnBody.indexOf('setFinished(true);');
    const restingBranchIndex = fnBody.indexOf('startRest({');

    expect(isLastOverallCheck).toBeGreaterThan(-1);
    expect(setFinishedCall).toBeGreaterThan(-1);
    expect(restingBranchIndex).toBeGreaterThan(-1);
    // `setFinished(true)` must be reached (and return) BEFORE the resting
    // branch further down the function body.
    expect(setFinishedCall).toBeLessThan(restingBranchIndex);
    expect(fnBody.indexOf('return;', setFinishedCall)).toBeLessThan(restingBranchIndex);
  });
});
