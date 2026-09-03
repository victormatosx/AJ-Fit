/**
 * Regression test for the real crash: "Cannot read property 'r' of
 * undefined" at `ex.sets[setIdx].r`, reported when finishing the last set
 * of the last exercise. `WorkoutScreen.tsx` pulls in `react-native`, which
 * this Node-environment Vitest config can't import — following the
 * codebase's structural-test convention for such files (see
 * `src/state/__tests__/appStateIdentityScope.test.ts`), this pins the exact
 * control-flow invariant that fixes it, straight from the source.
 *
 * Root cause: `order` (and the `exIdx`/`setIdx` derived from it) is only
 * ever left pointing at an exercise with sets remaining while `finished` is
 * false — both completion paths (`advanceAfterRest`'s last-exercise branch
 * and `completeSet`'s `isLastOverall` branch) flip `finished` to `true` in
 * the SAME update as the progress/order change that would otherwise leave
 * `setIdx` pointing past the end of `ex.sets`. The crash happened because
 * `const curReps = ex.sets[setIdx].r` was computed BEFORE the component's
 * `if (finished) return <WorkoutDone/>` early return, so the render that
 * landed right after `finished` became true still evaluated it with a
 * stale/out-of-range `setIdx`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');

describe('WorkoutScreen — finish-workout crash (ex.sets[setIdx].r of undefined)', () => {
  it('computes curReps/curLast (ex.sets[setIdx] access) AFTER the `if (finished) return` early exit, never before', () => {
    const finishedReturnIdx = source.indexOf('if (finished) {');
    const curRepsIdx = source.indexOf('const curReps = ex.sets[setIdx].r;');
    expect(finishedReturnIdx).toBeGreaterThan(-1);
    expect(curRepsIdx).toBeGreaterThan(-1);
    expect(curRepsIdx).toBeGreaterThan(finishedReturnIdx);
  });

  it('completeSet\'s last-set branch sets progress and finished in the same synchronous call, before any other state can be read', () => {
    const completeSetBody = source.slice(
      source.indexOf('const completeSet = () => {'),
      source.indexOf('const skipRest = () => {'),
    );
    const isLastOverallBranch = completeSetBody.slice(
      completeSetBody.indexOf('if (isLastOverall) {'),
      completeSetBody.indexOf('const completedSet ='),
    );
    expect(isLastOverallBranch).toContain('setProgress');
    expect(isLastOverallBranch).toContain('setFinished(true)');
  });

  it('advanceAfterRest flips finished to true in the same call that empties `order`, never leaving a stale non-empty order with finished still false', () => {
    const advanceBody = source.slice(
      source.indexOf('const advanceAfterRest = ('),
      source.indexOf("useEffect(() => {\n    if (restStatus !== 'expired'"),
    );
    const emptyOrderBranch = advanceBody.slice(advanceBody.indexOf('if (nextOrder.length === 0) {'));
    expect(emptyOrderBranch.slice(0, emptyOrderBranch.indexOf('}') + 1)).toContain('setFinished(true)');
  });

  it('the fallback exIdx (order empty) is only ever reached on the finished render, which returns before touching ex.sets[setIdx]', () => {
    // `order.length > 0 ? order[0] : 0` is the only place `exIdx` falls back
    // to a hardcoded index — that fallback must only be observable once
    // `finished` is already true (asserted above: the risky read happens
    // strictly after the early return).
    expect(source).toContain("const exIdx = order.length > 0 ? order[0] : 0;");
  });
});
