import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync('src/screens/AppShell.tsx', 'utf8');
const screen = readFileSync('src/screens/TreinoScreen.tsx', 'utf8');
const agenda = readFileSync('src/screens/TreinoAgendaSheet.tsx', 'utf8');

describe('TREINO hub wiring', () => {
  it('opens the hub from the tab without starting a workout', () => {
    const selectTab = shell.slice(shell.indexOf('const selectTab ='), shell.indexOf('const requestReposition'));
    expect(selectTab).toContain("setTab(nextTab)");
    expect(selectTab).not.toContain('requestStartWorkout(');
    expect(shell).toContain('<TreinoScreen');
  });

  it('routes start and continue through the canonical start entry point', () => {
    expect(shell).toMatch(/<TreinoScreen[\s\S]*?onStart={requestStartWorkout}/);
    expect(screen).toContain("workoutInProgress ? t('currentWorkout.continue')");
  });

  it('wires manual selection to reposition and agenda to its editor', () => {
    expect(shell).toMatch(/<TreinoScreen[\s\S]*?onReposition={requestReposition}/);
    expect(shell).toContain('<TreinoAgendaSheet');
    expect(screen).toContain('onOpenAgenda');
  });

  /**
   * "Fazer agora" is `onReposition(index)` followed by a bare `onStart()`.
   * Under the legacy cursor move the chosen session BECAME today's, so the
   * start could re-read the pointer. Under the pilot, selecting CONSUMES it
   * and the pointer already names the next one — so picking F opened the
   * confirmation for A. The chosen index must be carried explicitly, exactly
   * as the recovered-session path does.
   */
  it('a pilot selection carries the chosen session into the start confirmation', () => {
    const sheet = readFileSync('src/screens/TreinoWorkoutDetailSheet.tsx', 'utf8');
    // The sheet still starts without naming a session — so the shell must.
    expect(sheet).toContain('await onReposition(workout.sessionIndex)');
    expect(sheet).toMatch(/onReposition\(workout\.sessionIndex\)[\s\S]{0,120}onStart\(\)/);

    const pilotBranch = shell.slice(
      shell.indexOf('const next = await schedule.selectSession(targetSessionIndex);'),
      shell.indexOf('const handleSaveAgenda'),
    );
    expect(pilotBranch).toContain('setStartSessionOverride(targetSessionIndex);');
    // ...and only after the write was accepted, never on a refusal.
    expect(pilotBranch.indexOf("return 'ERROR';"))
      .toBeLessThan(pilotBranch.indexOf('setStartSessionOverride(targetSessionIndex);'));
    // The legacy branch must NOT set it: there the cursor really does move.
    const legacyBranch = shell.slice(
      shell.indexOf('const requestReposition'),
      shell.indexOf('const next = await schedule.selectSession(targetSessionIndex);'),
    );
    expect(legacyBranch).not.toContain('setStartSessionOverride');
  });

  it('blocks reposition and calendar/frequency mutation during an execution', () => {
    expect(shell.match(/if \(workoutInProgress \|\| workoutStartPending \|\| execution\.starting\) return/g)?.length)
      .toBeGreaterThanOrEqual(3);
    expect(screen).toContain('disabled={workoutInProgress}');
  });

  it('requires explicit confirmation before a frequency change invokes ADAPT', () => {
    expect(agenda).toContain("setStep('confirmFrequency')");
    expect(agenda).toContain('onPress={commitFrequencyChange}');
    expect(shell).toContain('adaptWorkoutProgram({');
  });
});
