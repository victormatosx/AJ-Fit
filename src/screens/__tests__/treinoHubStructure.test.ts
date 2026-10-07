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
