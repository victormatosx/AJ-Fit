import { isExerciseExecutable,type EquipmentContext } from '../workoutPrescription/equipment';
import { DIFFICULTY_RANK,purposePreserved } from '../workoutPrescription/equivalenceShared';
import type { CatalogExercise } from '../workoutPrescription/exerciseCatalog';

// Re-exported for backward compatibility — call sites/tests that import
// `purposePreserved`/`DIFFICULTY_RANK` from this module keep working
// unchanged after the Fase 1 behavior-preserving extraction (see
// `equivalenceShared.ts`).
export { purposePreserved };

function isOperationallyAvailable(exercise: CatalogExercise): boolean {
  return exercise.status === 'active' && exercise.availability.workoutGeneration && exercise.availability.substitution;
}

export function candidatePoolFor(
  source: CatalogExercise,
  catalog: ReadonlyMap<string, CatalogExercise>,
): string[] {
  const pool = new Set<string>();
  for (const id of source.substitution.similarExerciseIds) pool.add(id);
  const group = source.substitution.group;
  if (group) {
    for (const candidate of catalog.values()) {
      if (
        candidate.id !== source.id
        && candidate.substitution.group === group
        && candidate.movement.pattern === source.movement.pattern
        && candidate.movement.mechanic === source.movement.mechanic
      ) pool.add(candidate.id);
    }
  }
  pool.delete(source.id);
  return [...pool];
}

export interface EquivalenceCandidateEvaluation {
  exerciseId: string;
  eligible: boolean;
  reasonCodes: string[];
  declaredSimilar: boolean;
  recentlyUsed: boolean;
  difficultyDistance: number;
}

export interface EquivalenceSlotContext {
  sessionName: string;
  sessionType: string;
  exerciseIndex: number;
  isMovementAnchor: boolean;
  sourceMovementPattern: CatalogExercise['movement']['pattern'];
  sourceMechanic: CatalogExercise['movement']['mechanic'];
}

export function evaluateEquivalenceCandidate(input: {
  source: CatalogExercise;
  candidateId: string;
  catalog: ReadonlyMap<string, CatalogExercise>;
  equipmentContext: EquipmentContext;
  usedExerciseIds: ReadonlySet<string>;
  recentExerciseIds: ReadonlySet<string>;
  slotContext?: EquivalenceSlotContext;
}): EquivalenceCandidateEvaluation {
  const reasonCodes: string[] = [];
  const candidate = input.catalog.get(input.candidateId);
  if (input.usedExerciseIds.has(input.candidateId)) reasonCodes.push('DUPLICATE_IN_PLAN');
  if (input.slotContext?.isMovementAnchor) reasonCodes.push('ANCHOR_SLOT_IMMUTABLE');
  if (!candidate || !isOperationallyAvailable(candidate)) reasonCodes.push('CANDIDATE_UNAVAILABLE');
  if (candidate && !purposePreserved(input.source, candidate)) reasonCodes.push('PURPOSE_MISMATCH');
  if (candidate && candidate.movement.mechanic !== input.source.movement.mechanic) reasonCodes.push('ROLE_MISMATCH');
  if (
    candidate
    && input.slotContext
    && (
      (candidate.movement.pattern !== input.slotContext.sourceMovementPattern)
      || (candidate.movement.mechanic !== input.slotContext.sourceMechanic)
    )
  ) reasonCodes.push('SESSION_CONTEXT_MISMATCH');
  if (candidate && !isExerciseExecutable(candidate, input.equipmentContext)) reasonCodes.push('EQUIPMENT_UNAVAILABLE');
  return {
    exerciseId: input.candidateId,
    eligible: reasonCodes.length === 0,
    reasonCodes,
    declaredSimilar: input.source.substitution.similarExerciseIds.includes(input.candidateId),
    recentlyUsed: input.recentExerciseIds.has(input.candidateId),
    difficultyDistance: candidate
      ? Math.abs(DIFFICULTY_RANK[candidate.difficulty] - DIFFICULTY_RANK[input.source.difficulty])
      : Number.POSITIVE_INFINITY,
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function rankCandidates(
  evaluations: readonly EquivalenceCandidateEvaluation[],
  tieBreakSalt: string,
): EquivalenceCandidateEvaluation[] {
  const eligible = evaluations.filter((evaluation) => evaluation.eligible);
  return [...eligible].sort((a, b) => {
    const tupleA = [a.declaredSimilar ? 0 : 1, a.recentlyUsed ? 1 : 0, a.difficultyDistance];
    const tupleB = [b.declaredSimilar ? 0 : 1, b.recentlyUsed ? 1 : 0, b.difficultyDistance];
    for (let index = 0; index < tupleA.length; index += 1) {
      if (tupleA[index] !== tupleB[index]) return tupleA[index] - tupleB[index];
    }
    const hashA = stableHash(`${a.exerciseId}:${tieBreakSalt}`);
    const hashB = stableHash(`${b.exerciseId}:${tieBreakSalt}`);
    if (hashA !== hashB) return hashA < hashB ? -1 : 1;
    return a.exerciseId.localeCompare(b.exerciseId);
  });
}
