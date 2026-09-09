import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');
const headerStatus = readFileSync(
  new URL('../../components/workout/WorkoutRestHeaderStatus.tsx', import.meta.url),
  'utf8',
);

describe('minimized active workout UX', () => {
  it('returns directly to an active workout without showing start confirmation', () => {
    // selectTab funnels every 'workout' tab tap through requestStartWorkout,
    // which is what actually decides resume-vs-gated-confirmation.
    const selectTabStart = appShell.indexOf('const selectTab = (nextTab: TabId) => {');
    const selectTabEnd = appShell.indexOf('};', selectTabStart);
    const selectTab = appShell.slice(selectTabStart, selectTabEnd);
    expect(selectTab).toContain('requestStartWorkout();');

    const requestStartWorkoutStart = appShell.indexOf('const requestStartWorkout = useCallback(() => {');
    const requestStartWorkoutEnd = appShell.indexOf('}, [workoutInProgress', requestStartWorkoutStart);
    const requestStartWorkout = appShell.slice(requestStartWorkoutStart, requestStartWorkoutEnd);
    expect(requestStartWorkout).toContain('if (workoutInProgress)');
    expect(requestStartWorkout).toContain("setTab('workout')");
    expect(appShell).toContain("visible={startWorkoutFlow === 'confirmation' && !workoutInProgress}");
  });

  it('keeps WorkoutScreen mounted and makes it non-interactive only while hidden', () => {
    expect(appShell).toContain("{workoutInProgress && prescription.status === 'SUCCESS' && (");
    expect(appShell).toContain("pointerEvents={tab === 'workout' ? 'auto' : 'none'}");
    expect(appShell).toContain("accessibilityElementsHidden={tab !== 'workout'}");
  });

  it('turns the Today card into a return-to-workout design', () => {
    expect(home).toContain("'home:activeWorkout.kicker'");
    expect(home).toContain("'home:activeWorkout.cardStatus'");
    expect(home).toContain("'home:activeWorkout.return'");
    expect(home).toContain('name="arrow-right"');
    expect(home).toContain('paddingHorizontal: workoutInProgress ? 16 : 26');
    expect(home).toContain('fontSize: workoutInProgress ? 13 : 15');
  });

  it('shows the timer inside the greeting row and adds an arrow when rest finishes', () => {
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
    expect(headerStatus).toContain('{restFinished && (');
    expect(headerStatus).toContain('name="arrow-right"');
    expect(headerStatus).toContain('width: restFinished ? 106 : 86');
    expect(headerStatus).not.toContain('<LinearGradient');
    expect(headerStatus).not.toContain('shadowOpacity');
  });
});
