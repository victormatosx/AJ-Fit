import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const context = readFileSync('src/state/RestSessionContext.tsx', 'utf8');
const contextCode = context.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const appShell = readFileSync('src/screens/AppShell.tsx', 'utf8');
const workout = readFileSync('src/screens/WorkoutScreen.tsx', 'utf8');
const storage = readFileSync('src/services/restSessionStorage.ts', 'utf8');

describe('RestSessionProvider ownership and lifecycle', () => {
  it('wraps AppShellContent above the ephemeral WorkoutScreen', () => {
    const providerStart = appShell.indexOf('<RestSessionProvider');
    const content = appShell.indexOf('<AppShellContent');
    const providerEnd = appShell.indexOf('</RestSessionProvider>');

    expect(providerStart).toBeGreaterThan(-1);
    expect(providerStart).toBeLessThan(content);
    expect(content).toBeLessThan(providerEnd);
    expect(appShell).toContain("{tab === 'workout'");
    expect(appShell).toContain('<WorkoutScreen');
  });

  it('creates UUIDs through the already-installed Expo Crypto API', () => {
    expect(contextCode).toContain("import { randomUUID } from 'expo-crypto'");
    expect(contextCode).toContain('preferredId ?? randomUUID()');
    expect(contextCode).toContain('restId: randomUUID()');
  });

  it('reconciles only on a return to active and removes the AppState listener', () => {
    expect(contextCode).toContain("AppState.addEventListener('change'");
    expect(contextCode).toContain("previous !== 'active' && next === 'active'");
    expect(contextCode).toContain("reconcileExpiration(Date.now(), 'foreground')");
    expect(contextCode).toContain('subscription.remove()');
  });

  it('uses one absolute deadline wake-up, never a decrementing Context ticker', () => {
    expect(contextCode).toContain('current.rest.endsAt - Date.now()');
    expect(contextCode).toContain('REST_DEADLINE_ALERT_GRACE_MS');
    expect(contextCode).toContain("? 'deadline'");
    expect(contextCode).toContain(": 'delayed'");
    expect(contextCode).not.toContain('setInterval(');
    expect(contextCode).not.toContain('setRestLeft');
  });

  it('discards persisted process-death state without inventing a workout', () => {
    expect(contextCode).toContain('readRestSession()');
    expect(contextCode).toContain("reason: 'workout-not-restorable'");
    expect(contextCode).toContain('cleanupRestSessionArtifacts()');
    expect(contextCode).not.toContain('setTab(');
    expect(contextCode).not.toContain('setProgress(');
    expect(contextCode).not.toContain('setLogged(');
  });

  it('remounts the provider per authenticated identity and cleans account switches', () => {
    expect(appShell).toContain("<RestSessionProvider key={user?.uid ?? 'signed-out'}>");
  });

  it('exposes domain operations, not arbitrary temporal setters', () => {
    const publicApi = contextCode.slice(
      contextCode.indexOf('interface RestSessionContextValue'),
      contextCode.indexOf('const RestSessionContext ='),
    );
    for (const operation of [
      'beginWorkoutSession',
      'syncWorkoutActivity',
      'endWorkoutSession',
      'startRest',
      'addSeconds',
      'cancelRest',
      'consumeExpiration',
      'publishNextAction',
    ]) expect(publicApi).toContain(operation);
    for (const forbidden of ['setEndsAt', 'setStartedAt', 'setStatus', 'setSessionId']) {
      expect(publicApi).not.toContain(forbidden);
    }
  });
});

describe('WorkoutScreen temporal integration', () => {
  it('keeps a local visual ticker that samples Date.now instead of decrementing', () => {
    expect(workout).toContain('const tick = () => setRestNow(Date.now())');
    expect(workout).toContain('computeRemainingSeconds(rest, restNow)');
    expect(workout).not.toMatch(/setRestLeft\(\(r\)\s*=>\s*r\s*-\s*1\)/);
  });

  it('+15 and skip use the Context domain operations', () => {
    expect(workout).toContain('onAdd15={() => addRestSeconds(15)}');
    expect(workout).toContain('if (cancelRest(rest.restId)) {');
    expect(workout).toContain('publishNextAction(rest.restId);');
  });

  it('reconnects a remounted screen to the active rest exercise and set', () => {
    expect(workout).toContain('candidate.id === rest.exerciseId');
    expect(workout).toContain('[restingExerciseIndex]: rest.setIndex }');
    expect(workout).toContain('exId: rest.exerciseId, exIdx: restingExerciseIndex, setIdx: rest.setIndex');
  });

  it('allows minimizing without ending the provider-owned workout session', () => {
    expect(appShell).toContain("onMinimize={() => { setWorkoutExecutionVisible(false); setTab('home'); }}");
    expect(appShell).toContain('onDone={finishWorkoutSession}');
  });
});

describe('rest persistence boundaries', () => {
  it('serializes transition writes and uses one versioned AsyncStorage key', () => {
    expect(storage).toContain("'@ajfit/rest-session/v1'");
    expect(storage).toContain('transitionQueue.then(operation)');
  });

  it('does not persist from the visual one-second ticker', () => {
    const ticker = workout.slice(
      workout.indexOf('const tick = () => setRestNow(Date.now())'),
      workout.indexOf('const ovr ='),
    );
    expect(ticker).not.toContain('AsyncStorage');
    expect(ticker).not.toContain('persistRestSession');
  });
});
