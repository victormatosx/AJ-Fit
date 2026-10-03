import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync('src/screens/WorkoutScreen.tsx', 'utf8');
const hook = readFileSync('src/workoutExecution/useWorkoutExecution.ts', 'utf8');
const shell = readFileSync('src/screens/AppShell.tsx', 'utf8');

describe('optimistic completed-set wiring', () => {
  it('registers the mutation and projects COMPLETED in the same turn without awaiting Firestore', () => {
    const recordStart = hook.indexOf('const recordSet =');
    const enqueue = hook.indexOf('const persistence = mutationQueueRef.current.enqueue(mutationKey', recordStart);
    const setter = hook.indexOf('setExecution((current) => {', hook.indexOf('const recordSet ='));
    const confirmation = hook.indexOf('const flight = persistence.then', recordStart);
    expect(enqueue).toBeGreaterThan(-1);
    expect(setter).toBeGreaterThan(-1);
    expect(setter).toBeGreaterThan(enqueue);
    expect(confirmation).toBeGreaterThan(setter);
    expect(hook.slice(enqueue, setter)).not.toContain('await persistence');
    expect(hook).toContain('projectSetCompleted(');
  });

  it('renders REGISTRADO from the local execution projection and advances locally', () => {
    expect(screen).toContain("const justLogged = executionSet?.status === 'COMPLETED' && done");
    expect(screen).toContain('setProgress(nextProgress)');
    expect(screen).toContain('onSetLogged?.(transitionPending.exIdx');
    expect(screen).toContain("'set_registered_visible'");
    expect(hook).toContain("'set_persist_confirmed'");
  });

  it('keeps the workout mounted while minimized so the in-memory queue survives', () => {
    expect(shell).toContain("{workoutInProgress && !workoutStartPending");
    expect(shell).toContain("pointerEvents={tab === 'workout' ? 'auto' : 'none'}");
    expect(shell).toContain("{ opacity: tab === 'workout' ? 1 : 0");
  });

  it('serializes immediate same-set editing behind the original record', () => {
    expect(hook).toContain('recordSetFlightsRef.current.get(recordMutationKey)');
    expect(hook).toContain('retryFailedMutation(recordMutationKey)');
    expect(hook).toContain('mutationQueueRef.current.enqueue(editMutationKey');
  });

  it('rolls back only permanent failures and leaves transient writes retryable', () => {
    expect(hook).toContain("if (failureKind === 'PERMANENT')");
    expect(hook).toContain('rollbackOptimisticSetCompletion(');
    expect(hook).toContain('markFailedMutationPermanent(mutationKey, error)');
    expect(hook).toContain('setHasUnreconciledMutations(true)');
  });
});
