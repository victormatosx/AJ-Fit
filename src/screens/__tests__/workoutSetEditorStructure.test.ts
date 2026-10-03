import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync('src/screens/WorkoutScreen.tsx', 'utf8');
const shell = readFileSync('src/screens/AppShell.tsx', 'utf8');
const hook = readFileSync('src/workoutExecution/useWorkoutExecution.ts', 'utf8');
const service = readFileSync('src/services/workoutExecutions.ts', 'utf8');

describe('completed-set editor wiring', () => {
  it('opens only from a projected/confirmed COMPLETED set in an IN_PROGRESS execution', () => {
    expect(screen).toContain("executionSet?.status !== 'COMPLETED'");
    expect(screen).toContain("execution?.status !== 'IN_PROGRESS'");
    expect(screen).toContain("executionSet?.status === 'COMPLETED' && done");
    expect(screen).toContain('disabled={!editable}');
  });

  it('pre-fills from persisted actual values and keeps drafts local until save', () => {
    expect(screen).toContain("initialSet.actualReps === null ? '' : String(initialSet.actualReps)");
    expect(screen).toContain("initialSet.weightKg === null");
    expect(screen).toContain('const [repsText, setRepsText]');
    expect(screen).toContain('const [weightText, setWeightText]');
    expect(screen).toContain('const result = await onSave(patch)');
    expect(screen).toContain('onCancel={() => setSetEditor(null)}');
  });

  it('guards double submit and retains draft state after persistence errors', () => {
    expect(screen).toContain('if (savingRef.current) return;');
    expect(screen).toContain('accessibilityState={{ disabled: saving, busy: saving }}');
    expect(screen).toContain('if (!result.ok) setSaveFailed(true)');
    expect(screen).not.toContain('if (!result.ok) setSetEditor(null)');
    expect(hook).toContain('beginCompletedSetEditFlight(editSetFlightsRef.current, recordMutationKey');
    expect(hook).toContain('mutationQueueRef.current.discardFailedMutation(editMutationKey)');
    expect(hook).toContain('retryFailedMutation(recordMutationKey)');
  });

  it('uses the authoritative hook queue and transaction, not a screen-level Firestore write', () => {
    expect(shell).toContain('execution.editCompletedSet(exerciseIndex, setIndex, patch)');
    expect(hook).toContain('mutationQueueRef.current.enqueue(mutationKey');
    expect(hook).toContain('editCompletedSetExecution({');
    expect(service).toContain("if (data.status !== 'IN_PROGRESS') throw new Error('EXECUTION_NOT_IN_PROGRESS')");
    expect(service).toContain('applyCompletedSetEdit(');
    expect(screen).not.toContain("from 'firebase/firestore'");
  });

  it('provides accessible labels for open, fields, +/−, save, and cancel', () => {
    for (const key of [
      'editSet.accessibility.open',
      'editSet.accessibility.decreaseReps',
      'editSet.accessibility.increaseReps',
      'editSet.accessibility.repsInput',
      'editSet.accessibility.decreaseLoad',
      'editSet.accessibility.increaseLoad',
      'editSet.accessibility.loadInput',
      'editSet.accessibility.save',
      'editSet.accessibility.cancel',
    ]) expect(screen).toContain(key);
  });

  it('keeps the original stacked editor hierarchy with slimmer controls', () => {
    expect(screen).toContain('const controlButtonStyle');
    expect(screen).toContain('width: 44');
    expect(screen).toContain('height: 44');
    expect(screen).toContain('paddingVertical: 14');
    expect(screen).toContain('borderTopWidth: repsEnabled ? 1 : 0');
    expect(screen).toContain('minHeight: 48');
    expect(screen).not.toContain('const stepButtonStyle');
  });
});
