import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workout = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
const executionHook = readFileSync(new URL('../../workoutExecution/useWorkoutExecution.ts', import.meta.url), 'utf8');

describe('workout early-finish structure', () => {
  it('keeps minimize and finish filled in white, with tertiary discard and no action icons', () => {
    const choiceBlock = workout.slice(
      workout.indexOf("exitSheet === 'choice'"),
      workout.indexOf("exitSheet === 'early'"),
    );
    expect(choiceBlock).toContain("t('exit.minimize')");
    expect(choiceBlock.match(/backgroundColor: exitDialogTheme\.colors\.inverseSurface/g)).toHaveLength(2);
    expect(choiceBlock).toContain("t('exit.finishNow')");
    expect(choiceBlock).not.toContain('<Icon name="minus"');
    expect(choiceBlock).not.toContain('<Icon name="check"');
    expect(choiceBlock).toContain("t('exit.discard')");
    expect(choiceBlock).toContain('color: exitDialogTheme.colors.dangerText');
    expect(choiceBlock).not.toContain("t('exit.cancel')");
    expect(choiceBlock.indexOf("t('exit.minimize')"))
      .toBeLessThan(choiceBlock.indexOf("t('exit.finishNow')"));
    expect(choiceBlock.indexOf("t('exit.finishNow')"))
      .toBeLessThan(choiceBlock.indexOf("t('exit.discard')"));
    expect(workout).toContain("setExitSheet('early')");
    expect(workout).toContain("setExitSheet('earlyEmpty')");
  });

  it('blocks zero-set early finish and protects the confirmation against repeated taps', () => {
    expect(workout).toContain('if (completedSetsForEarlyFinish === 0)');
    expect(workout).toContain('earlyFinishRequestedRef.current');
    expect(workout).toContain('if (completedSetsForEarlyFinish === 0 || earlyFinishRequestedRef.current || finishing) return;');
    const earlyConfirmationBlock = workout.slice(
      workout.indexOf("exitSheet === 'early'"),
      workout.indexOf("exitSheet === 'earlyEmpty'"),
    );
    expect(earlyConfirmationBlock).not.toContain('<Icon name="check"');
  });

  it('routes EARLY through the existing AppShell and mutation-flushed finalizer', () => {
    expect(shell).toContain("runWorkoutCompletion(false, undefined, 'EARLY')");
    expect(shell).toContain('execution.finalize(actualCardioDurationSeconds, mode)');
    expect(executionHook).toContain('await mutationQueueRef.current.flush()');
    expect(executionHook).toContain("...(mode === 'NORMAL' ? {} : { mode })");
  });

  it('ends the shared lock-screen surface for strength completion and EARLY cardio skip', () => {
    expect(shell).toContain("if (!hasCardioFinisher || mode === 'EARLY') endWorkoutSession();");
  });

  it('does not retain the duplicate dead WorkoutExitDialog implementation', () => {
    expect(workout).not.toContain('function WorkoutExitDialog(');
  });

  it('never persists skipped cardio through the normal duration payload', () => {
    expect(workout).toContain("finalizationMode === 'EARLY'");
    expect(workout).toContain('onEarlyFinish()');
    expect(workout).toContain('onCardioCompleted?.(actualDurationSeconds)');
  });
});
