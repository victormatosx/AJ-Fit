import manualRelations from '../data/manualExerciseRelations.json';
import { isExerciseExecutable,type EquipmentContext } from './equipment';
import { DIFFICULTY_RANK,purposePreserved } from './equivalenceShared';
import type { CatalogExercise,ExerciseCatalog } from './exerciseCatalog';

export type ManualSubstitutionReasonCode =
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_NOT_AVAILABLE_FOR_MANUAL_SUBSTITUTION'
  | 'PURPOSE_MISMATCH'
  | 'ROLE_MISMATCH'
  | 'EQUIPMENT_UNAVAILABLE'
  | 'DUPLICATE_IN_SESSION'
  | 'SAME_AS_ANCHOR';

export interface ManualSubstitutionCandidateEvaluation {
  exerciseId: string;
  eligible: boolean;
  reasonCodes: ManualSubstitutionReasonCode[];
  declaredSimilar: boolean;
  difficultyDistance: number;
  lateralityMatch: boolean;
}

export interface ManualSubstitutionResolutionInput {
  anchorExerciseId: string;
  catalog: ExerciseCatalog;
  equipmentContext: EquipmentContext;
  effectiveExerciseIdsInSession: ReadonlySet<string>;
  maxResults?: number;
}

export type ManualSubstitutionResolutionResult =
  | { status: 'INVALID_ANCHOR' }
  | { status: 'NO_ELIGIBLE_CANDIDATES'; evaluated: ManualSubstitutionCandidateEvaluation[] }
  | { status: 'RESOLVED'; candidates: ManualSubstitutionCandidateEvaluation[]; evaluated: ManualSubstitutionCandidateEvaluation[] };

function buildManualSubstitutionCandidatePool(
  source: CatalogExercise,
  catalog: ExerciseCatalog,
): Set<string> {
  const pool = new Set<string>();
  for (const id of source.substitution.similarExerciseIds) pool.add(id);
  for (const id of (manualRelations as Record<string, string[]>)[source.id] ?? []) pool.add(id);
  const group = source.substitution.group;
  if (group) {
    for (const candidate of catalog.values()) {
      if (
        candidate.id !== source.id
        && candidate.substitution.group === group
        && candidate.movement.pattern === source.movement.pattern
      ) {
        pool.add(candidate.id);
      }
    }
  }
  pool.delete(source.id);
  return pool;
}

export function evaluateManualSubstitutionCandidate(input: {
  source: CatalogExercise;
  candidateId: string;
  catalog: ExerciseCatalog;
  equipmentContext: EquipmentContext;
  effectiveExerciseIdsInSession: ReadonlySet<string>;
}): ManualSubstitutionCandidateEvaluation {
  const reasonCodes: ManualSubstitutionReasonCode[] = [];
  const candidate = input.catalog.get(input.candidateId);
  if (input.candidateId === input.source.id) reasonCodes.push('SAME_AS_ANCHOR');
  if (input.effectiveExerciseIdsInSession.has(input.candidateId)) reasonCodes.push('DUPLICATE_IN_SESSION');

  if (!candidate) {
    return {
      exerciseId: input.candidateId,
      eligible: false,
      reasonCodes: [...reasonCodes, 'CANDIDATE_NOT_FOUND'],
      declaredSimilar: false,
      difficultyDistance: Number.POSITIVE_INFINITY,
      lateralityMatch: false,
    };
  }

  if (candidate.status !== 'active' || !candidate.availability.manualSelection || !candidate.availability.substitution) {
    reasonCodes.push('CANDIDATE_NOT_AVAILABLE_FOR_MANUAL_SUBSTITUTION');
  }
  if (!purposePreserved(input.source, candidate)) reasonCodes.push('PURPOSE_MISMATCH');

  if (candidate.movement.mechanic !== input.source.movement.mechanic) reasonCodes.push('ROLE_MISMATCH');
  if (!isExerciseExecutable(candidate, input.equipmentContext)) reasonCodes.push('EQUIPMENT_UNAVAILABLE');



  return {
    exerciseId: input.candidateId,
    eligible: reasonCodes.length === 0,
    reasonCodes,
    declaredSimilar: input.source.substitution.similarExerciseIds.includes(input.candidateId),
    difficultyDistance: Math.abs(DIFFICULTY_RANK[candidate.difficulty] - DIFFICULTY_RANK[input.source.difficulty]),
    lateralityMatch: candidate.movement.laterality === input.source.movement.laterality,
  };
}

export function rankManualSubstitutionCandidates(
  evaluations: readonly ManualSubstitutionCandidateEvaluation[],
): ManualSubstitutionCandidateEvaluation[] {
  const eligible = evaluations.filter((evaluation) => evaluation.eligible);
  return [...eligible].sort((a, b) => {
    const tupleA = [
      a.declaredSimilar ? 0 : 1,
      a.difficultyDistance,
      a.lateralityMatch ? 0 : 1,
    ];
    const tupleB = [
      b.declaredSimilar ? 0 : 1,
      b.difficultyDistance,
      b.lateralityMatch ? 0 : 1,
    ];
    for (let index = 0; index < tupleA.length; index += 1) {
      if (tupleA[index] !== tupleB[index]) return tupleA[index] - tupleB[index];
    }
    return a.exerciseId.localeCompare(b.exerciseId);
  });
}

export const MANUAL_SUBSTITUTION_DEFAULT_MAX_RESULTS = 3;

export function resolveManualSubstitutionCandidates(
  input: ManualSubstitutionResolutionInput,
): ManualSubstitutionResolutionResult {
  const source = input.catalog.get(input.anchorExerciseId);
  if (!source) return { status: 'INVALID_ANCHOR' };

  const pool = buildManualSubstitutionCandidatePool(source, input.catalog);
  const evaluated = [...pool]
    .sort()
    .map((candidateId) => evaluateManualSubstitutionCandidate({
      source,

      candidateId,
      catalog: input.catalog,
      equipmentContext: input.equipmentContext,
      effectiveExerciseIdsInSession: input.effectiveExerciseIdsInSession,
    }));

  const ranked = rankManualSubstitutionCandidates(evaluated);
  if (ranked.length === 0) return { status: 'NO_ELIGIBLE_CANDIDATES', evaluated };
  const maxResults = input.maxResults ?? MANUAL_SUBSTITUTION_DEFAULT_MAX_RESULTS;
  return { status: 'RESOLVED', candidates: ranked.slice(0, maxResults), evaluated };
}

export function evaluateRevertToAnchor(input: {
  anchorExerciseId: string;
  catalog: ExerciseCatalog;
  equipmentContext: EquipmentContext;
  effectiveExerciseIdsInSession: ReadonlySet<string>;
}): { eligible: boolean; reasonCodes: ManualSubstitutionReasonCode[] } {
  const source = input.catalog.get(input.anchorExerciseId);
  if (!source) return { eligible: false, reasonCodes: ['CANDIDATE_NOT_FOUND'] };
  const reasonCodes: ManualSubstitutionReasonCode[] = [];
  if (input.effectiveExerciseIdsInSession.has(input.anchorExerciseId)) reasonCodes.push('DUPLICATE_IN_SESSION');
  if (source.status !== 'active' || !source.availability.manualSelection || !source.availability.substitution) {
    reasonCodes.push('CANDIDATE_NOT_AVAILABLE_FOR_MANUAL_SUBSTITUTION');
  }
  if (!isExerciseExecutable(source, input.equipmentContext)) reasonCodes.push('EQUIPMENT_UNAVAILABLE');

  return { eligible: reasonCodes.length === 0, reasonCodes };
}

export function resolvePermanentSubstitutionsForSession(input: {
  sessionExerciseIds: readonly string[];
  preferences: ReadonlyMap<string, string>;
  catalog: ExerciseCatalog;
  equipmentContext: EquipmentContext;
}): Map<number, string> {
  const resolved = new Map<number, string>();
  const effective = [...input.sessionExerciseIds];
  for (let index = 0; index < input.sessionExerciseIds.length; index += 1) {
    const anchorExerciseId = input.sessionExerciseIds[index];
    const preferredExerciseId = input.preferences.get(anchorExerciseId);
    if (!preferredExerciseId || preferredExerciseId === anchorExerciseId) continue;
    const source = input.catalog.get(anchorExerciseId);
    if (!source) continue; // anchor unknown to this catalog — leave prescribed, never guess.
    const effectiveElsewhere = new Set(effective.filter((_, otherIndex) => otherIndex !== index));
    const evaluation = evaluateManualSubstitutionCandidate({
      source,
      candidateId: preferredExerciseId,
      catalog: input.catalog,
      equipmentContext: input.equipmentContext,
      effectiveExerciseIdsInSession: effectiveElsewhere,
    });
      // the A->X / B->X collision above) -> fall back to the prescribed
    // exercise. Never substitutes a third candidate on the user's behalf —
    // they chose this specific preferredExerciseId, not "any safe swap".
    if (!evaluation.eligible) continue;
    effective[index] = preferredExerciseId;
    resolved.set(index, preferredExerciseId);
  }
  return resolved;
}
