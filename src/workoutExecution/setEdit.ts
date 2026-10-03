import type { ResolvedUnits } from '../types/units';
import {
  workoutLoadStep,
  workoutLoadToKg,
} from '../units/workoutLoadConversions';
import type { ExerciseExecution, SetExecution } from './types';

export type CompletedSetEditPatch = {
  actualReps?: number | null;
  weightKg?: number | null;
};

export class CompletedSetEditError extends Error {
  constructor(readonly code:
    | 'INVALID_SET_COORDINATES'
    | 'SET_NOT_COMPLETED'
    | 'INVALID_ACTUAL_REPS'
    | 'INVALID_WEIGHT_KG'
    | 'EMPTY_EDIT') {
    super(code);
    this.name = 'CompletedSetEditError';
  }
}

function owns(patch: CompletedSetEditPatch, key: keyof CompletedSetEditPatch): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

/**
 * Pure authoritative-array update used by the Firestore transaction. It
 * addresses both levels by their persisted indices, changes only the two
 * editable facts, and refuses to turn a non-completed set into a completion.
 */
export function applyCompletedSetEdit(
  exercises: readonly ExerciseExecution[],
  exerciseIndex: number,
  setIndex: number,
  patch: CompletedSetEditPatch,
): { exercises: ExerciseExecution[]; set: SetExecution } {
  const changesReps = owns(patch, 'actualReps');
  const changesWeight = owns(patch, 'weightKg');
  if (!changesReps && !changesWeight) throw new CompletedSetEditError('EMPTY_EDIT');
  if (changesReps && patch.actualReps !== null
    && (typeof patch.actualReps !== 'number' || !Number.isInteger(patch.actualReps) || patch.actualReps <= 0)) {
    throw new CompletedSetEditError('INVALID_ACTUAL_REPS');
  }
  if (changesWeight && patch.weightKg !== null
    && (typeof patch.weightKg !== 'number' || !Number.isFinite(patch.weightKg) || patch.weightKg < 0)) {
    throw new CompletedSetEditError('INVALID_WEIGHT_KG');
  }

  const exercisePosition = exercises.findIndex((exercise) => exercise.exerciseIndex === exerciseIndex);
  const exercise = exercises[exercisePosition];
  if (!exercise) throw new CompletedSetEditError('INVALID_SET_COORDINATES');
  const setPosition = exercise.sets.findIndex((set) => set.setIndex === setIndex);
  const currentSet = exercise.sets[setPosition];
  if (!currentSet) throw new CompletedSetEditError('INVALID_SET_COORDINATES');
  if (currentSet.status !== 'COMPLETED') throw new CompletedSetEditError('SET_NOT_COMPLETED');

  const editedSet: SetExecution = {
    ...currentSet,
    ...(changesReps ? { actualReps: patch.actualReps ?? null } : {}),
    ...(changesWeight ? { weightKg: patch.weightKg ?? null } : {}),
  };
  const nextExercise: ExerciseExecution = {
    ...exercise,
    sets: exercise.sets.map((set, index) => index === setPosition ? editedSet : set),
  };
  return {
    exercises: exercises.map((item, index) => index === exercisePosition ? nextExercise : item),
    set: editedSet,
  };
}

export type ParsedSetEditDraft =
  | { ok: true; actualReps: number | null; weightKg: number | null }
  | { ok: false; field: 'actualReps' | 'weightKg' };

/** Empty text deliberately means persisted absence (`null`), never zero. */
export function parseSetEditDraft(
  repsText: string,
  weightText: string,
  units: ResolvedUnits,
): ParsedSetEditDraft {
  const trimmedReps = repsText.trim();
  let actualReps: number | null = null;
  if (trimmedReps !== '') {
    if (!/^\d+$/.test(trimmedReps)) return { ok: false, field: 'actualReps' };
    actualReps = Number(trimmedReps);
    if (!Number.isSafeInteger(actualReps) || actualReps <= 0) {
      return { ok: false, field: 'actualReps' };
    }
  }

  const trimmedWeight = weightText.trim();
  let weightKg: number | null = null;
  if (trimmedWeight !== '') {
    if (!/^\d+(?:[.,]\d+)?$/.test(trimmedWeight)) return { ok: false, field: 'weightKg' };
    const displayedWeight = Number(trimmedWeight.replace(',', '.'));
    weightKg = workoutLoadToKg(displayedWeight, units);
    if (!Number.isFinite(weightKg) || weightKg < 0) return { ok: false, field: 'weightKg' };
  }
  return { ok: true, actualReps, weightKg };
}

export function adjustSetEditRepsText(value: string, direction: -1 | 1): string {
  const parsed = /^\d+$/.test(value.trim()) ? Number(value.trim()) : 0;
  const next = parsed + direction;
  return next > 0 ? String(next) : '';
}

export function adjustSetEditWeightText(
  value: string,
  direction: -1 | 1,
  units: ResolvedUnits,
): string {
  const normalized = value.trim().replace(',', '.');
  const current = /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : 0;
  const next = Math.max(0, current + direction * workoutLoadStep(units));
  const rounded = Math.round(next * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Reuses one promise for rapid duplicate saves of the same persisted set. */
export function beginCompletedSetEditFlight<T>(
  flights: Map<string, Promise<T>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const existing = flights.get(key);
  if (existing) return existing;
  const flight = operation();
  flights.set(key, flight);
  void flight.then(
    () => { if (flights.get(key) === flight) flights.delete(key); },
    () => { if (flights.get(key) === flight) flights.delete(key); },
  );
  return flight;
}
