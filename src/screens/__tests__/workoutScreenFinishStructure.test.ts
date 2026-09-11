import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');

/** The final set has no recovery countdown, but still needs the same load
 * registration surface as every other set before workout completion/cardio. */
describe('WorkoutScreen.completeSet — final set load registration', () => {
  it('keeps the final set pending without starting a recovery countdown', () => {
    const fnStart = source.indexOf('const completeSet = () => {');
    const fnBody = source.slice(fnStart, source.indexOf('const skipRest = () => {', fnStart));
    const isLastOverallCheck = fnBody.indexOf('if (isLastOverall)');
    const setPendingCall = fnBody.indexOf('setPending(completedSet);');
    const startRestCall = fnBody.indexOf('startRest({');

    expect(fnStart).toBeGreaterThan(-1);
    expect(setPendingCall).toBeGreaterThan(-1);
    expect(isLastOverallCheck).toBeGreaterThan(setPendingCall);
    expect(fnBody).toContain('if (isLastOverall) return;');
    expect(startRestCall).toBeGreaterThan(isLastOverallCheck);
  });

  it('renders RestOverlay in final-load mode and advances through the shared transition', () => {
    expect(source).toContain('const finalSetLoadEntry = isLastOverall && pending !== null && !resting;');
    expect(source).toContain('const remainingRestSeconds = resting ? computeRemainingSeconds(rest, restNow) : 0;');
    expect(source).toContain('{(resting || finalSetLoadEntry) && (');
    expect(source).toContain('remainingSeconds={remainingRestSeconds}');
    expect(source).toContain('finalSetLoadEntry={finalSetLoadEntry}');
    expect(source).toContain('continuesToCardio={!!cardioFinisher}');
    expect(source).toContain('onSkip={finalSetLoadEntry ? () => advanceAfterRest() : skipRest}');
  });

  it('reuses the regular rest presentation with a zeroed timer for the final set', () => {
    const overlayStart = source.indexOf('function RestOverlay({');
    const overlayBody = source.slice(overlayStart, source.indexOf('function PROverlay({', overlayStart));

    expect(overlayStart).toBeGreaterThan(-1);
    expect(overlayBody).toContain("{t('rest.title').toUpperCase()}");
    expect(overlayBody).toContain('{fmt(remainingSeconds)}');
    expect(overlayBody).toContain("? t('rest.continueToCardio')");
    expect(overlayBody).toContain(": t('rest.finishWorkout')");
  });
});
