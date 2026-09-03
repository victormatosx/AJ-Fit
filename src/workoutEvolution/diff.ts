/** Deterministic, session/slot-aware comparison of two immutable
 * prescriptions. Identity is always `exerciseId`, never a localized name. */

export interface DiffableExercise {
  exerciseId: string;
  sets?: number;
  reps?: string;
  restSeconds?: number;
}

export interface DiffableSession {
  sessionId?: string;
  name?: string;
  type?: string;
  exercises: readonly DiffableExercise[];
}

export interface DiffablePlan {
  sessions: readonly DiffableSession[];
  prescribedTrainingFrequency?: number;
  prescribedStructuredDays: number;
  split: string;
}

export interface ExerciseReplacement {
  sessionIndex: number;
  slotIndex: number;
  fromExerciseId: string;
  toExerciseId: string;
}

export interface PrescriptionDiffSummary {
  exerciseReplacements: ExerciseReplacement[];
  preservedExerciseCount: number;
  addedExerciseCount: number;
  removedExerciseCount: number;
  addedSessionCount: number;
  removedSessionCount: number;
  reorderedSessionCount: number;
  setsChangedCount: number;
  repsChangedCount: number;
  restChangedCount: number;
  frequencyChange: { before: number; after: number } | null;
  sessionCountChange: { before: number; after: number } | null;
  splitChanged: boolean;
  hasObservableChanges: boolean;
}

function sameMultiset(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const id of left) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const id of right) {
    const remaining = counts.get(id) ?? 0;
    if (remaining === 0) return false;
    if (remaining === 1) counts.delete(id);
    else counts.set(id, remaining - 1);
  }
  return counts.size === 0;
}

function prescriptionChanges(left: DiffableExercise, right: DiffableExercise): { sets: number; reps: number; rest: number } {
  return {
    sets: left.sets === right.sets ? 0 : 1,
    reps: left.reps === right.reps ? 0 : 1,
    rest: left.restSeconds === right.restSeconds ? 0 : 1,
  };
}

function sessionIdentity(session: DiffableSession): string | null {
  if (session.sessionId) return `id:${session.sessionId}`;
  if (session.name && session.type) return `descriptor:${session.type}:${session.name}`;
  return null;
}

function pairLogicalSessions(current: DiffablePlan, pending: DiffablePlan): Array<{
  currentIndex: number;
  pendingIndex: number;
}> {
  const allowDescriptorIdentity = current.split === pending.split;
  const pendingByIdentity = new Map<string, number>();
  pending.sessions.forEach((session, index) => {
    const identity = sessionIdentity(session);
    if (identity?.startsWith('id:') || (allowDescriptorIdentity && identity)) {
      if (!pendingByIdentity.has(identity)) pendingByIdentity.set(identity, index);
    }
  });

  const pairs: Array<{ currentIndex: number; pendingIndex: number }> = [];
  const usedPending = new Set<number>();
  current.sessions.forEach((session, currentIndex) => {
    const identity = sessionIdentity(session);
    const identityUsable = identity?.startsWith('id:') || (allowDescriptorIdentity && identity);
    const byIdentity = identityUsable ? pendingByIdentity.get(identity!) : undefined;
    if (byIdentity != null && !usedPending.has(byIdentity)) {
      usedPending.add(byIdentity);
      pairs.push({ currentIndex, pendingIndex: byIdentity });
      return;
    }
    // Legacy records without a structural descriptor may use position only
    // while the split itself is unchanged. Across a split change we prefer a
    // generic structural claim over an invented exercise replacement.
    if (!identity && allowDescriptorIdentity && currentIndex < pending.sessions.length
      && !sessionIdentity(pending.sessions[currentIndex]) && !usedPending.has(currentIndex)) {
      usedPending.add(currentIndex);
      pairs.push({ currentIndex, pendingIndex: currentIndex });
    }
  });
  return pairs;
}

function occurrenceKey(exerciseId: string, occurrence: number): string {
  return `${exerciseId}\u0000${occurrence}`;
}

function keyedByOccurrence(exercises: readonly DiffableExercise[]): Map<string, DiffableExercise> {
  const occurrences = new Map<string, number>();
  const result = new Map<string, DiffableExercise>();
  for (const exercise of exercises) {
    const occurrence = occurrences.get(exercise.exerciseId) ?? 0;
    occurrences.set(exercise.exerciseId, occurrence + 1);
    result.set(occurrenceKey(exercise.exerciseId, occurrence), exercise);
  }
  return result;
}

export function computePrescriptionDiff(input: { current: DiffablePlan; pending: DiffablePlan }): PrescriptionDiffSummary {
  const exerciseReplacements: ExerciseReplacement[] = [];
  let preservedExerciseCount = 0;
  let addedExerciseCount = 0;
  let removedExerciseCount = 0;
  let addedSessionCount = 0;
  let removedSessionCount = 0;
  let reorderedSessionCount = 0;
  let setsChangedCount = 0;
  let repsChangedCount = 0;
  let restChangedCount = 0;
  const pairs = pairLogicalSessions(input.current, input.pending);
  const pairedCurrent = new Set(pairs.map((pair) => pair.currentIndex));
  const pairedPending = new Set(pairs.map((pair) => pair.pendingIndex));

  for (const { currentIndex, pendingIndex } of pairs) {
    const current = input.current.sessions[currentIndex].exercises;
    const pending = input.pending.sessions[pendingIndex].exercises;
    const currentIds = current.map((exercise) => exercise.exerciseId);
    const pendingIds = pending.map((exercise) => exercise.exerciseId);
    const reordered = currentIds.some((id, index) => id !== pendingIds[index])
      && sameMultiset(currentIds, pendingIds);

    if (reordered) {
      reorderedSessionCount += 1;
      preservedExerciseCount += current.length;
      const currentByOccurrence = keyedByOccurrence(current);
      const pendingByOccurrence = keyedByOccurrence(pending);
      for (const [key, currentExercise] of currentByOccurrence) {
        const changed = prescriptionChanges(currentExercise, pendingByOccurrence.get(key)!);
        setsChangedCount += changed.sets;
        repsChangedCount += changed.reps;
        restChangedCount += changed.rest;
      }
      continue;
    }

    const sharedSlotCount = Math.min(current.length, pending.length);
    for (let slotIndex = 0; slotIndex < sharedSlotCount; slotIndex += 1) {
      const currentExercise = current[slotIndex];
      const pendingExercise = pending[slotIndex];
      if (currentExercise.exerciseId !== pendingExercise.exerciseId) {
        exerciseReplacements.push({ sessionIndex: pendingIndex, slotIndex, fromExerciseId: currentExercise.exerciseId, toExerciseId: pendingExercise.exerciseId });
        continue;
      }
      preservedExerciseCount += 1;
      const changed = prescriptionChanges(currentExercise, pendingExercise);
      setsChangedCount += changed.sets;
      repsChangedCount += changed.reps;
      restChangedCount += changed.rest;
    }
    removedExerciseCount += Math.max(0, current.length - pending.length);
    addedExerciseCount += Math.max(0, pending.length - current.length);
  }

  for (let index = 0; index < input.current.sessions.length; index += 1) {
    if (pairedCurrent.has(index)) continue;
    removedSessionCount += 1;
    removedExerciseCount += input.current.sessions[index].exercises.length;
  }
  for (let index = 0; index < input.pending.sessions.length; index += 1) {
    if (pairedPending.has(index)) continue;
    addedSessionCount += 1;
    addedExerciseCount += input.pending.sessions[index].exercises.length;
  }

  const frequencyBefore = input.current.prescribedTrainingFrequency ?? input.current.prescribedStructuredDays;
  const frequencyAfter = input.pending.prescribedTrainingFrequency ?? input.pending.prescribedStructuredDays;
  const frequencyChange = frequencyBefore === frequencyAfter ? null : { before: frequencyBefore, after: frequencyAfter };
  const sessionCountChange = input.current.sessions.length === input.pending.sessions.length
    ? null
    : { before: input.current.sessions.length, after: input.pending.sessions.length };
  const splitChanged = input.current.split !== input.pending.split;
  const hasObservableChanges = exerciseReplacements.length > 0 || addedExerciseCount > 0
    || removedExerciseCount > 0 || reorderedSessionCount > 0 || setsChangedCount > 0
    || repsChangedCount > 0 || restChangedCount > 0 || frequencyChange !== null
    || sessionCountChange !== null || splitChanged || addedSessionCount > 0 || removedSessionCount > 0;

  return { exerciseReplacements, preservedExerciseCount, addedExerciseCount, removedExerciseCount,
    addedSessionCount, removedSessionCount, reorderedSessionCount, setsChangedCount, repsChangedCount,
    restChangedCount, frequencyChange, sessionCountChange,
    splitChanged, hasObservableChanges };
}
