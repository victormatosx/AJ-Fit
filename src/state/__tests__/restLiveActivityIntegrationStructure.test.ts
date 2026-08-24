import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const context = readFileSync('src/state/RestSessionContext.tsx', 'utf8');
const workout = readFileSync('src/screens/WorkoutScreen.tsx', 'utf8');
const facade = readFileSync('src/lib/restLiveActivity.ts', 'utf8');
const contract = readFileSync('src/types/restLiveActivity.ts', 'utf8');
const bridge = readFileSync('modules/ajfit-rest-activity/index.ts', 'utf8');

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('rest live presentation boundary', () => {
  it('keeps a small absolute presentation contract', () => {
    const stateContract = contract.slice(
      contract.indexOf('export type RestActivityState'),
      contract.indexOf('export type RestActivityEndReason'),
    );
    for (const field of [
      'sessionId',
      'startedAt',
      'endsAt',
      'exerciseName',
      'setIndex',
      'totalSets',
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

  it('ships only the optional TypeScript bridge in this phase', () => {
    expect(readdirSync('modules/ajfit-rest-activity').sort()).toEqual(['index.ts']);
  });

  it('materializes the translated exercise name outside the temporal domain', () => {
    expect(workout).toContain(
      'exerciseName: translateExerciseName(tLoose, ex.db, ex.name)',
    );
    expect(codeOnly(context)).not.toContain('EXERCISES');
  });

  it('maps absolute time and converts the set index to one-based presentation', () => {
    expect(context).toContain('startedAt: rest.startedAt');
    expect(context).toContain('endsAt: rest.endsAt');
    expect(context).toContain('setIndex: rest.setIndex + 1');
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
    expect(updateBlock).toContain('const activityState = { ...currentActivityState, endsAt: rest.endsAt }');
    expect(updateBlock).toContain('void restLiveActivity.update(activityState)');
  });

  it('ends only after the domain claims expiry or cancellation', () => {
    const cancelBlock = context.slice(
      context.indexOf('const cancelRest ='),
      context.indexOf('const consumeExpiration ='),
    );
    const consumeBlock = context.slice(
      context.indexOf('const consumeExpiration ='),
      context.indexOf('// A single absolute deadline'),
    );
    expect(cancelBlock.indexOf('if (!transition.consumed) return false')).toBeLessThan(
      cancelBlock.indexOf("void restLiveActivity.end('cancelled')"),
    );
    expect(consumeBlock.indexOf('if (!transition.consumed) return false')).toBeLessThan(
      consumeBlock.indexOf("void restLiveActivity.end('completed')"),
    );
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

  it('never calls the facade from the one-second visual ticker', () => {
    const ticker = workout.slice(
      workout.indexOf('const tick = () => setRestNow(Date.now())'),
      workout.indexOf('const ovr ='),
    );
    expect(ticker).not.toContain('restLiveActivity');
    expect(ticker).not.toContain('.update(');
  });
});
