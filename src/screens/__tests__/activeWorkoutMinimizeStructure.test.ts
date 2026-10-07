import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');
const headerStatus = readFileSync(
  new URL('../../components/workout/WorkoutRestHeaderStatus.tsx', import.meta.url),
  'utf8',
);

describe('minimized active workout UX', () => {
  it('returns to the workout hub first and continues through its explicit CTA', () => {
    const selectTabStart = appShell.indexOf('const selectTab = (nextTab: TabId) => {');
    const selectTabEnd = appShell.indexOf('};', selectTabStart);
    const selectTab = appShell.slice(selectTabStart, selectTabEnd);
    expect(selectTab).toContain('setWorkoutExecutionVisible(false)');
    expect(selectTab).not.toContain('requestStartWorkout();');

    const requestStartWorkoutStart = appShell.indexOf('const requestStartWorkout = useCallback(() => {');
    const requestStartWorkoutEnd = appShell.indexOf('}, [workoutInProgress', requestStartWorkoutStart);
    const requestStartWorkout = appShell.slice(requestStartWorkoutStart, requestStartWorkoutEnd);
    expect(requestStartWorkout).toContain('if (workoutInProgress)');
    expect(requestStartWorkout).toContain("setTab('workout')");
    expect(appShell).toContain("visible={startWorkoutFlow === 'confirmation' && !workoutInProgress}");
  });

  it('keeps WorkoutScreen mounted and makes it non-interactive only while hidden', () => {
    expect(appShell).toContain("{workoutInProgress && !workoutStartPending && !execution.starting && execution.execution && prescription.status === 'SUCCESS' && (");
    expect(appShell).toContain("pointerEvents={tab === 'workout' && workoutExecutionVisible ? 'auto' : 'none'}");
    expect(appShell).toContain("accessibilityElementsHidden={tab !== 'workout' || !workoutExecutionVisible}");
  });

  it('turns the Today card into a return-to-workout design', () => {
    expect(home).toContain("'home:activeWorkout.kicker'");
    expect(home).toContain("'home:activeWorkout.cardStatus'");
    expect(home).toContain("'home:activeWorkout.return'");
    expect(home).toContain('name="arrow-right"');
    expect(home).toContain('paddingHorizontal: workoutInProgress ? 16 : 26');
    expect(home).toContain('fontSize: workoutInProgress ? 13 : 15');
  });

  it('shows the active-workout control before the first set, during rest, and between rests', () => {
    const greetingStart = home.indexOf('{/* greeting */}');
    const tickerStart = home.indexOf('{/* Real Training Level', greetingStart);
    const greeting = home.slice(greetingStart, tickerStart);

    expect(home).toContain('<WorkoutRestHeaderStatus');
    expect(greeting.indexOf('<WorkoutRestHeaderStatus')).toBeLessThan(
      greeting.indexOf('<ProfileAvatar'),
    );
    expect(appShell).not.toContain('ActiveWorkoutPill');
    expect(headerStatus).toContain('computeRemainingSeconds(rest, now)');
    expect(headerStatus).toContain('const timer = setInterval(tick, 1000)');
    expect(headerStatus).not.toContain('setNow((previous) => previous - 1)');
    expect(headerStatus).toContain("t('activeWorkout.nextExercise')");
    expect(headerStatus).toContain("t('activeWorkout.nextSet'");
    expect(headerStatus).toContain('{countdown}');
    expect(headerStatus).toContain('if (!workoutInProgress) return null;');
    expect(headerStatus).not.toContain('lastRestRef');
    expect(headerStatus).toContain('{rest !== null && (');
    expect(headerStatus).toContain('{!resting && (');
    expect(headerStatus).toContain('name="arrow-right"');
    expect(headerStatus).toContain('width: rest === null ? 42 : restFinished ? 106 : 86');
    expect(headerStatus).toContain("backgroundColor: 'transparent'");
    expect(headerStatus).toContain('borderColor: theme.colors.primaryBorderSoft');
    expect(headerStatus).not.toContain('backgroundColor: theme.colors.primarySurfaceSubtle');
    expect(headerStatus).not.toContain('<LinearGradient');
    expect(headerStatus).not.toContain('shadowOpacity');
  });
});
