import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const context = readFileSync('src/state/RestSessionContext.tsx', 'utf8');
const workout = readFileSync('src/screens/WorkoutScreen.tsx', 'utf8');
const appShell = readFileSync('src/screens/AppShell.tsx', 'utf8');
const facade = readFileSync('src/lib/restLiveActivity.ts', 'utf8');
const contract = readFileSync('src/types/restLiveActivity.ts', 'utf8');
const bridge = readFileSync('modules/ajfit-rest-activity/index.ts', 'utf8');

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('rest live presentation boundary', () => {
  it('keeps a small absolute presentation contract', () => {
    const stateContract = contract.slice(0, contract.indexOf('export type RestActivityEndReason'));
    for (const field of [
      'sessionId',
      'startedAt',
      'endsAt',
      'exerciseName',
      'setIndex',
      'totalSets',
      'phase',
      'nextAction',
      'nextSetIndex',
      'nextExerciseName',
    ]) expect(stateContract).toContain(field);
    for (const forbidden of [
      'remainingSeconds',
      'restLeft',
      'exerciseId',
      'templateId',
      'primary_goal',
      'premium',
    ]) expect(stateContract).not.toContain(forbidden);
  });

  it('uses optional module capability detection and no Platform inference', () => {
    expect(bridge).toContain("requireOptionalNativeModule<AJFitRestActivityNativeModule>('AJFitRestActivity')");
    expect(facade).toContain('nativeModule.getCapabilities()');
    expect(codeOnly(facade)).not.toContain('Platform.OS');
  });

  it('keeps the bridge optional while registering Apple and Android modules', () => {
    const config = readFileSync(
      'modules/ajfit-rest-activity/expo-module.config.json',
      'utf8',
    );
    expect(config).toContain('"platforms": ["apple", "android"]');
    expect(config).toContain('AJFitRestActivityModule');
    expect(config).toContain('com.ajfit.restactivity.AJFitRestActivityModule');
    expect(existsSync('modules/ajfit-rest-activity/ios')).toBe(true);
  });

  it('materializes the translated exercise name outside the temporal domain', () => {
    expect(workout).toContain('exerciseName: ex.name');
    expect(workout).toContain('workoutExercisesFromPlan(plan, i18n.language, sessionIndex)');
    expect(codeOnly(context)).not.toContain('EXERCISES');
    expect(workout).toContain('materializeRestNextAction({');
    expect(workout).toContain('resolve(exercises[order[1]], order[1]).name');
  });

  it('maps absolute time and converts the set index to one-based presentation', () => {
    expect(context).toContain('startedAt: rest.startedAt');
    expect(context).toContain('endsAt: rest.endsAt');
    expect(context).toContain('setIndex: rest.setIndex + 1');
    expect(context).toContain('phase: REST_ACTIVITY_PHASE.RESTING');
  });
});

describe('RestSessionContext live transition wiring', () => {
  it('starts after creating the absolute rest state', () => {
    const startBlock = context.slice(
      context.indexOf('const startRest ='),
      context.indexOf('const addSeconds ='),
    );
    expect(startBlock.indexOf('const rest = createRest({')).toBeLessThan(
      startBlock.indexOf('void restLiveActivity.start(activityState)'),
    );
    expect(startBlock).toContain('void persistRestSession(rest)');
  });

  it('updates only after +seconds returns a new absolute endsAt', () => {
    const updateBlock = context.slice(
      context.indexOf('const addSeconds ='),
      context.indexOf('const reconcileExpiration ='),
    );
    expect(updateBlock).toContain('const rest = addRestSeconds(current.rest, seconds)');
    expect(updateBlock).toContain('const activityState = { ...currentActivityState.state, endsAt: rest.endsAt }');
    expect(updateBlock).toContain('void restLiveActivity.update(activityState)');
    expect(updateBlock).not.toContain('alert: true');
  });

  it('publishes a next action only after the domain claims expiry or cancellation', () => {
    const cancelBlock = context.slice(
      context.indexOf('const cancelRest ='),
      context.indexOf('const consumeExpiration ='),
    );
    const consumeBlock = context.slice(
      context.indexOf('const consumeExpiration ='),
      context.indexOf('const publishNextAction ='),
    );
    expect(cancelBlock).not.toContain('restLiveActivity.update');
    expect(consumeBlock).not.toContain('restLiveActivity.update');
    const expirationTransition = workout.slice(
      workout.indexOf("if (restStatus !== 'expired'"),
      workout.indexOf('const completeSet ='),
    );
    expect(expirationTransition.indexOf('advanceAfterRest();')).toBeLessThan(
      expirationTransition.indexOf('publishNextAction(rest.restId);'),
    );
    const skipTransition = workout.slice(
      workout.indexOf('const skipRest ='),
      workout.indexOf('const skipExercise ='),
    );
    expect(skipTransition.indexOf('advanceAfterRest();')).toBeLessThan(
      skipTransition.indexOf('publishNextAction(rest.restId);'),
    );
  });

  it('alerts only an on-time deadline transition, never +15, skip or foreground reconciliation', () => {
    const publishBlock = context.slice(
      context.indexOf('const publishNextAction ='),
      context.indexOf('// A single absolute deadline'),
    );
    expect(publishBlock).toContain("expirationSourceRef.current === 'deadline'");
    expect(publishBlock).toContain('{ alert: shouldAlert }');
    expect(context).toContain('REST_DEADLINE_ALERT_GRACE_MS');
    expect(context).toContain(": 'delayed'");
    expect(context).toContain("reconcileExpiration(Date.now(), 'foreground')");
    const cancelBlock = context.slice(
      context.indexOf('const cancelRest ='),
      context.indexOf('const consumeExpiration ='),
    );
    expect(cancelBlock).toContain('expirationSourceRef.current = null');
  });

  it('ends a relevant logical surface once when the workout session ends', () => {
    const endBlock = context.slice(
      context.indexOf('const endWorkoutSession ='),
      context.indexOf('const startRest ='),
    );
    expect(endBlock).toContain('if (restActivitySessionStartedRef.current)');
    expect(endBlock).toContain("void restLiveActivity.end('workout_ended')");
    expect(endBlock).toContain('restActivitySessionStartedRef.current = false');
  });

  it('keeps completed cardio visible until the final workout CTA', () => {
    const completionBlock = appShell.slice(
      appShell.indexOf('const runWorkoutCompletion ='),
      appShell.indexOf('const retryWorkoutCompletion ='),
    );
    const finalCtaBlock = appShell.slice(
      appShell.indexOf('const finishWorkoutSession ='),
      appShell.indexOf('const discardWorkoutSession ='),
    );
    expect(completionBlock).toContain(
      'if (!hasCardioFinisher) endWorkoutSession()',
    );
    expect(finalCtaBlock).toContain('endWorkoutSession()');
  });

  it('cleans storage and native orphans together on cold start', () => {
    expect(context).toContain("from '../services/restSessionCleanup'");
    expect(context).toContain('void cleanupRestSessionArtifacts()');
    expect(facade).toContain('function cleanup(): Promise<void>');
    expect(bridge).toContain('cleanup?(): void | Promise<void>');
  });

  it('never calls the facade from the one-second visual ticker', () => {
    const ticker = workout.slice(
      workout.indexOf('const tick = () => setRestNow(Date.now())'),
      workout.indexOf('const ovr ='),
    );
    expect(ticker).not.toContain('restLiveActivity');
    expect(ticker).not.toContain('.update(');
  });
});
