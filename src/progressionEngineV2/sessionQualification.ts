import { PROGRESSION_V2_CONFIG, type ProgressionV2Config } from './config';

interface QualifiableSet {
  setIndex?: number;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
}

interface QualifiableExercise {
  exerciseIndex?: number;
  exerciseId?: string;
  /**
   * The plan's own exercise id, recorded alongside the EXECUTED one whenever
   * the user substituted an exercise (`src/workoutExecution/types.ts`'s
   * `prescribedExerciseIdOf`). It is what the immutable snapshot must be
   * matched against — matching on `exerciseId` alone made every substituted
   * session fail qualification here while the server's own
   * `prescribedExecutionCounts` accepted it, so a legitimate workout counted
   * for the EARN authority and not for the adherence the user was shown.
   */
  prescribedExerciseId?: string;
  sets: readonly QualifiableSet[];
}

/** "Foi prescrito A e executado B" — mirrors `prescribedExerciseIdOf`, kept
 * here so this module stays dependency-free and syncable. */
function prescribedIdOf(exercise: QualifiableExercise): string | undefined {
  return exercise.prescribedExerciseId ?? exercise.exerciseId;
}

interface QualifiableExecution {
  programInstanceId?: string;
  sessionIndex?: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'ABANDONED';
  exercises: readonly QualifiableExercise[];
}

export interface PrescribedExerciseShape {
  exerciseId: string;
  /** Materialized set count. Duration/circuit slots use one execution set. */
  setCount: number;
}

export interface PrescribedSessionShape {
  exercises: readonly PrescribedExerciseShape[];
}

export interface SetCompletionCount {
  completed: number;
  total: number;
}

/** Sums completed/total sets across every exercise actually recorded on the execution — never invented from exercise counts (docs §8/§48). */
export function countPrescribedSetsCompletion(exercises: readonly QualifiableExercise[]): SetCompletionCount {
  let completed = 0;
  let total = 0;
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      total += 1;
      if (set.status === 'COMPLETED') completed += 1;
    }
  }
  return { completed, total };
}

/**
 * A session counts toward progression when it's COMPLETED, or when it's
 * PARTIALLY_COMPLETED and at least `partialSessionMinSetCompletionPercent`
 * of its prescribed sets were actually completed (docs progression/06 §6-8).
 * IN_PROGRESS and ABANDONED never qualify. Uses an integer percentage
 * comparison (`completed*100 >= total*threshold`) instead of dividing floats,
 * so 7/10 and 6/10 land exactly where the spec boundary requires without any
 * floating-point rounding risk.
 */
export function isValidProgressionSession(
  execution: QualifiableExecution,
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): boolean {
  if (execution.status !== 'COMPLETED' && execution.status !== 'PARTIALLY_COMPLETED') return false;
  const { completed, total } = countPrescribedSetsCompletion(execution.exercises);
  if (total === 0) return false;
  return completed * 100 >= total * config.partialSessionMinSetCompletionPercent;
}

/**
 * Qualifies a terminal V2 execution against the immutable ProgramSnapshot
 * session it claims to execute. The execution is evidence only: it never
 * defines exercise/set identities or its own denominator.
 *
 * A malformed shape fails closed. Extra/unknown/duplicate exercises and sets
 * cannot add credit, while omitted prescribed work remains in the denominator.
 */
export function isValidProgressionSessionAgainstPrescription(input: {
  execution: QualifiableExecution;
  prescribedSession: PrescribedSessionShape | undefined;
  expectedProgramInstanceId: string;
  expectedSessionIndex: number;
  config?: ProgressionV2Config;
}): boolean {
  const { execution, prescribedSession } = input;
  if (!prescribedSession) return false;
  if (execution.status !== 'COMPLETED' && execution.status !== 'PARTIALLY_COMPLETED') return false;
  if (execution.programInstanceId !== input.expectedProgramInstanceId) return false;
  if (execution.sessionIndex !== input.expectedSessionIndex) return false;
  if (execution.exercises.length !== prescribedSession.exercises.length) return false;

  let completed = 0;
  let total = 0;
  const seenExercises = new Set<number>();
  for (const recordedExercise of execution.exercises) {
    const exerciseIndex = recordedExercise.exerciseIndex;
    if (!Number.isInteger(exerciseIndex) || exerciseIndex == null || seenExercises.has(exerciseIndex)) return false;
    seenExercises.add(exerciseIndex);
    const prescribedExercise = prescribedSession.exercises[exerciseIndex];
    if (!prescribedExercise || prescribedIdOf(recordedExercise) !== prescribedExercise.exerciseId) return false;
    if (recordedExercise.sets.length !== prescribedExercise.setCount) return false;
    total += prescribedExercise.setCount;

    const seenSets = new Set<number>();
    for (const recordedSet of recordedExercise.sets) {
      const setIndex = recordedSet.setIndex;
      if (!Number.isInteger(setIndex) || setIndex == null || seenSets.has(setIndex)) return false;
      if (setIndex < 0 || setIndex >= prescribedExercise.setCount) return false;
      seenSets.add(setIndex);
      if (recordedSet.status === 'COMPLETED') completed += 1;
    }
  }
  if (total === 0) return false;
  const config = input.config ?? PROGRESSION_V2_CONFIG;
  return completed * 100 >= total * config.partialSessionMinSetCompletionPercent;
}
