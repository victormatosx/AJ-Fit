import { describe, expect, it } from 'vitest';
import { computePrescriptionDiff, type DiffablePlan } from '../diff';

const ex = (exerciseId: string, sets = 3, reps = '8-10', restSeconds = 60) => ({ exerciseId, sets, reps, restSeconds });
function plan(overrides: Partial<DiffablePlan> = {}): DiffablePlan {
  return { sessions: [
    { exercises: [ex('a'), ex('b'), ex('c')] },
    { exercises: [ex('d'), ex('e')] },
  ], prescribedTrainingFrequency: 4, prescribedStructuredDays: 4, split: 'upper_lower', ...overrides };
}

describe('computePrescriptionDiff truth matrix', () => {
  it('handles an identical/no-change prescription honestly', () => {
    expect(computePrescriptionDiff({ current: plan(), pending: plan() })).toMatchObject({
      exerciseReplacements: [], preservedExerciseCount: 5, addedExerciseCount: 0,
      removedExerciseCount: 0, addedSessionCount: 0, removedSessionCount: 0,
      reorderedSessionCount: 0, setsChangedCount: 0,
      repsChangedCount: 0, restChangedCount: 0, frequencyChange: null, sessionCountChange: null,
      splitChanged: false, hasObservableChanges: false,
    });
  });

  it('reports real slot-aware replacements with session and slot context', () => {
    const pending = plan({ sessions: [
      { exercises: [ex('a2'), ex('b'), ex('c2')] },
      { exercises: [ex('d'), ex('e2')] },
    ] });
    expect(computePrescriptionDiff({ current: plan(), pending }).exerciseReplacements).toEqual([
      { sessionIndex: 0, slotIndex: 0, fromExerciseId: 'a', toExerciseId: 'a2' },
      { sessionIndex: 0, slotIndex: 2, fromExerciseId: 'c', toExerciseId: 'c2' },
      { sessionIndex: 1, slotIndex: 1, fromExerciseId: 'e', toExerciseId: 'e2' },
    ]);
  });

  it('detects a true reorder only when the session identity multiset is preserved', () => {
    const diff = computePrescriptionDiff({ current: plan(), pending: plan({ sessions: [
      { exercises: [ex('b'), ex('a'), ex('c')] },
      { exercises: [ex('d'), ex('e')] },
    ] }) });
    expect(diff.reorderedSessionCount).toBe(1);
    expect(diff.exerciseReplacements).toEqual([]);
  });

  it('does not claim reorder for substitutions, additions or removals', () => {
    const diff = computePrescriptionDiff({ current: plan(), pending: plan({ sessions: [
      { exercises: [ex('a'), ex('x'), ex('c'), ex('new')] },
      { exercises: [ex('d')] },
    ] }) });
    expect(diff.reorderedSessionCount).toBe(0);
    expect(diff.exerciseReplacements).toHaveLength(1);
    expect(diff.addedExerciseCount).toBe(1);
    expect(diff.removedExerciseCount).toBe(1);
  });

  it('claims sets and reps only for the same exercise identity', () => {
    const diff = computePrescriptionDiff({ current: plan(), pending: plan({ sessions: [
      { exercises: [ex('a', 4, '8-10'), ex('b', 3, '10-12'), ex('replacement', 9, '1')] },
      { exercises: [ex('d'), ex('e')] },
    ] }) });
    expect(diff.setsChangedCount).toBe(1);
    expect(diff.repsChangedCount).toBe(1);
    expect(diff.exerciseReplacements).toHaveLength(1);
  });

  it('claims rest changes only for the same exercise identity', () => {
    const diff = computePrescriptionDiff({ current: plan(), pending: plan({ sessions: [
      { exercises: [ex('a', 3, '8-10', 90), ex('b'), ex('replacement', 3, '8-10', 120)] },
      { exercises: [ex('d'), ex('e')] },
    ] }) });
    expect(diff.restChangedCount).toBe(1);
    expect(diff.exerciseReplacements).toHaveLength(1);
  });

  it('emits frequency, session-count and split claims only on actual changes', () => {
    const unchanged = computePrescriptionDiff({ current: plan(), pending: plan() });
    expect(unchanged).toMatchObject({ frequencyChange: null, sessionCountChange: null, splitChanged: false });
    const changed = computePrescriptionDiff({ current: plan(), pending: plan({
      prescribedTrainingFrequency: 5, prescribedStructuredDays: 5, split: 'push_pull_legs',
      sessions: [...plan().sessions, { exercises: [ex('f')] }],
    }) });
    expect(changed.frequencyChange).toEqual({ before: 4, after: 5 });
    expect(changed.sessionCountChange).toEqual({ before: 2, after: 3 });
    expect(changed.splitChanged).toBe(true);
  });

  it('falls back to the legacy structured-days frequency', () => {
    const diff = computePrescriptionDiff({ current: plan({ prescribedTrainingFrequency: undefined, prescribedStructuredDays: 3 }), pending: plan() });
    expect(diff.frequencyChange).toEqual({ before: 3, after: 4 });
  });

  it('is deterministic and independent of display names', () => {
    const input = { current: plan(), pending: plan({ sessions: [{ exercises: [ex('x'), ex('b'), ex('c')] }, plan().sessions[1]] }) };
    expect(computePrescriptionDiff(input)).toEqual(computePrescriptionDiff(input));
    expect(JSON.stringify(computePrescriptionDiff(input))).not.toContain('displayName');
  });

  it('does not invent replacements by pairing unrelated sessions across a split change', () => {
    const current = plan({ split: 'lower_upper', sessions: [
      { name: 'Lower', type: 'strength', exercises: [ex('squat'), ex('deadlift')] },
    ] });
    const pending = plan({ split: 'push_pull_legs', sessions: [
      { name: 'Push', type: 'strength', exercises: [ex('bench'), ex('overhead-press')] },
    ] });
    const diff = computePrescriptionDiff({ current, pending });
    expect(diff.exerciseReplacements).toEqual([]);
    expect(diff).toMatchObject({
      addedSessionCount: 1,
      removedSessionCount: 1,
      addedExerciseCount: 2,
      removedExerciseCount: 2,
      splitChanged: true,
    });
  });

  it('pairs a stable sessionId across split and display-name changes', () => {
    const current = plan({ split: 'legacy', sessions: [
      { sessionId: 'session-a', name: 'Lower', type: 'strength', exercises: [ex('squat')] },
    ] });
    const pending = plan({ split: 'new', sessions: [
      { sessionId: 'session-a', name: 'Session A', type: 'mixed', exercises: [ex('front-squat')] },
    ] });
    const diff = computePrescriptionDiff({ current, pending });
    expect(diff.exerciseReplacements).toEqual([
      { sessionIndex: 0, slotIndex: 0, fromExerciseId: 'squat', toExerciseId: 'front-squat' },
    ]);
    expect(diff).toMatchObject({ addedSessionCount: 0, removedSessionCount: 0 });
  });

  it('reports truly added and removed sessions without positional cross-pairing', () => {
    const current = plan({ sessions: [
      { sessionId: 'kept', exercises: [ex('a')] },
      { sessionId: 'removed', exercises: [ex('old')] },
    ] });
    const pending = plan({ sessions: [
      { sessionId: 'kept', exercises: [ex('a')] },
      { sessionId: 'added', exercises: [ex('new')] },
    ] });
    const diff = computePrescriptionDiff({ current, pending });
    expect(diff.exerciseReplacements).toEqual([]);
    expect(diff).toMatchObject({
      addedSessionCount: 1,
      removedSessionCount: 1,
      addedExerciseCount: 1,
      removedExerciseCount: 1,
    });
  });
});
