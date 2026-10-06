import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');

/**
 * In-app extension of the rest overlay: during the countdown after the
 * LAST set of the current exercise (not the last set of the whole workout),
 * the overlay now says "next exercise" and names it, instead of "next set".
 * This reuses the exact decision (`materializeRestNextAction`) already
 * authoritative for the Live Activity/Dynamic Island — no parallel rule.
 */
describe('WorkoutScreen rest overlay — nextSet vs nextExercise is a single decision', () => {
  it('(E) computes the next-exercise lookup exactly once, feeding both the Live Activity call site and the in-app one', () => {
    // The branching rule itself ("is there another exercise after this set")
    // must exist in exactly one place in the file — never duplicated with
    // rules that could drift apart.
    const ruleOccurrences = source.split(
      'if (completedSetIndex + 1 < totalSetsForCurrent || order.length <= 1) {',
    ).length - 1;
    expect(ruleOccurrences).toBe(1);

    // `materializeRestNextAction` — the authoritative nextSet/nextExercise
    // decision — is called exactly twice: once for `completeSet` (feeds
    // `startRest`/the Live Activity) and once for the in-app `restNextAction`
    // memo. A third call site would mean a second, divergence-prone rule.
    const decisionCalls = source.split('materializeRestNextAction({').length - 1;
    expect(decisionCalls).toBe(2);
  });

  it('completeSet feeds the shared lookup into the Live Activity decision', () => {
    const fnStart = source.indexOf('const completeSet = () => {');
    const fnBody = source.slice(fnStart, source.indexOf('const skipRest = () => {', fnStart));
    expect(fnBody).toContain('nextExerciseContext(setIdx, ex.sets.length)');
    expect(fnBody).toContain('materializeRestNextAction({');
    expect(fnBody).toContain('nextExerciseName,');
    expect(fnBody).toContain('nextExerciseTotalSets,');
    expect(fnBody).toContain('...nextAction,');
  });

  it('restNextAction rebuilds the same decision from the authoritative, restorable rest record (not fresh component state)', () => {
    const memoStart = source.indexOf('const restNextAction = useMemo(');
    const memoBody = source.slice(memoStart, source.indexOf('const skipRest = () => {', memoStart));
    expect(memoStart).toBeGreaterThan(-1);
    expect(memoBody).toContain('if (!resting || !rest) return null;');
    expect(memoBody).toContain('nextExerciseContext(rest.setIndex, rest.totalSets)');
    expect(memoBody).toContain('materializeRestNextAction({');
    expect(memoBody).toContain('completedSetIndex: rest.setIndex,');
    expect(memoBody).toContain('totalSets: rest.totalSets,');
  });

  it('passes the decision down to RestOverlay as a single prop, not re-derived props', () => {
    expect(source).toContain('nextAction={restNextAction}');
    expect(source).toContain('nextAction?: MaterializedRestNextAction | null;');
  });
});

describe('WorkoutScreen rest overlay — button label and next-exercise indicator', () => {
  const overlayStart = source.indexOf('function RestOverlay({');
  const overlayBody = source.slice(overlayStart, source.indexOf('function PROverlay({', overlayStart));

  it('derives nextExerciseAction only from the shared nextAction decision, never standalone', () => {
    expect(overlayBody).toContain(
      "nextAction?.nextAction === REST_ACTIVITY_NEXT_ACTION.NEXT_EXERCISE",
    );
    expect(overlayBody).toContain('!finalSetLoadEntry && nextAction?.nextAction');
  });

  it('(A) an intermediate set keeps "next set"', () => {
    // When nextExerciseAction is null (nextAction is NEXT_SET, or there is
    // no active rest yet), the button falls through to the unchanged label.
    expect(overlayBody).toContain("t('rest.nextSet')");
    const ternaryIdx = overlayBody.indexOf('nextExerciseAction');
    const nextSetIdx = overlayBody.indexOf("t('rest.nextSet')", ternaryIdx);
    expect(nextSetIdx).toBeGreaterThan(ternaryIdx);
  });

  it('(B) the last set of an exercise (with another exercise left) switches the label and shows the next exercise', () => {
    expect(overlayBody).toContain("t('rest.nextExercise')");
    expect(overlayBody).toContain('{nextExerciseAction && (');
    expect(overlayBody).toContain('{nextExerciseAction.nextExerciseName}');
    expect(overlayBody).toContain(
      "t('rest.nextExerciseSets', { count: nextExerciseAction.nextExerciseTotalSets })",
    );
    // The label switch and the indicator are gated by the exact same value.
    const buttonBranchIdx = overlayBody.lastIndexOf('nextExerciseAction');
    const indicatorIdx = overlayBody.indexOf('{nextExerciseAction && (');
    expect(indicatorIdx).toBeGreaterThan(-1);
    expect(buttonBranchIdx).toBeGreaterThan(indicatorIdx);
  });

  it('(C) the true last set of the workout keeps "finish workout" untouched, and always wins over next-exercise', () => {
    expect(overlayBody).toContain("t('rest.finishWorkout')");
    expect(overlayBody).toContain('finalSetLoadEntry');
    // finalSetLoadEntry gates nextExerciseAction itself, so the button's
    // outer `finalSetLoadEntry ? … : …` branch is untouched and always wins.
    const finalSetIdx = overlayBody.indexOf('{finalSetLoadEntry');
    const finishWorkoutIdx = overlayBody.indexOf("t('rest.finishWorkout')", finalSetIdx);
    expect(finalSetIdx).toBeGreaterThan(-1);
    expect(finishWorkoutIdx).toBeGreaterThan(finalSetIdx);
  });

  it('(D) the cardio transition label is unchanged', () => {
    expect(overlayBody).toContain("t('rest.continueToCardio')");
    expect(overlayBody).toContain('continuesToCardio');
  });
});
