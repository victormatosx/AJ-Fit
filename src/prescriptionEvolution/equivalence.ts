import type { LimitationRegionId } from '../types/exercise';
import { validateLimitationProfile, type LimitationCatalogExercise } from '../workoutPrescription/limitationResolver';
import { isExerciseExecutable, type EquipmentContext } from '../workoutPrescription/equipment';

/**
 * Hard equivalence gate (docs prescription/03 — "same primary muscle" alone
 * is never equivalence). A candidate must share the source's movement
 * pattern AND either share its primary muscle or be an explicitly declared
 * limitation variant of it.
 */
export function purposePreserved(
  source: LimitationCatalogExercise,
  candidate: LimitationCatalogExercise,
): boolean {
  const samePattern = candidate.movement.pattern === source.movement.pattern;
  const samePrimaryMuscle = candidate.target.primaryMuscle === source.target.primaryMuscle;
  const explicitlyApprovedVariant = source.substitution.limitationVariantIds?.includes(candidate.id) ?? false;
  return samePattern && (samePrimaryMuscle || explicitlyApprovedVariant);
}

/**
 * Safety gate against the user's declared limitation regions. With no
 * declared regions, every operationally available exercise is safe from a
 * limitation standpoint. With declared regions, only a candidate carrying an
 * approved `limitationProfile` that is explicitly compatible for every
 * region is accepted — an exercise with no (or an unapproved) profile is
 * treated as unknown-risk, not safe-by-default, whenever the user has any
 * declared limitation (docs §14/§29/§30).
 */
export function isLimitationSafe(
  candidate: LimitationCatalogExercise,
  regions: readonly LimitationRegionId[],
): boolean {
  if (regions.length === 0) return true;
  const validation = validateLimitationProfile(candidate.id, candidate.limitationProfile);
  if (!validation.valid) return false;
  return regions.every((region) => {
    const status = validation.profile.regions[region].status;
    return status === 'compatible' || status === 'not_applicable';
  });
}

function isOperationallyAvailable(exercise: LimitationCatalogExercise): boolean {
  return exercise.status === 'active' && exercise.availability.workoutGeneration && exercise.availability.substitution;
}

/**
 * Candidate pool for a source exercise: its own declared
 * `substitution.similarExerciseIds`, plus every other catalog exercise
 * sharing its `substitution.group` AND movement pattern/mechanic (the same
 * "family" shape `limitationResolver.ts`'s ranked candidate builder already
 * uses — reused here rather than re-derived, docs §29).
 */
export function candidatePoolFor(
  source: LimitationCatalogExercise,
  catalog: ReadonlyMap<string, LimitationCatalogExercise>,
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

const DIFFICULTY_RANK = { beginner: 0, intermediate: 1, advanced: 2 } as const;

export interface EquivalenceCandidateEvaluation {
  exerciseId: string;
  eligible: boolean;
  reasonCodes: string[];
  declaredSimilar: boolean;
  recentlyUsed: boolean;
  difficultyDistance: number;
}

/** Slot-derived context. Session names are descriptive only; the reliable hard metadata is the source slot's movement/mechanic. */
export interface EquivalenceSlotContext {
  sessionName: string;
  sessionType: string;
  exerciseIndex: number;
  isMovementAnchor: boolean;
  sourceMovementPattern: LimitationCatalogExercise['movement']['pattern'];
  sourceMechanic: LimitationCatalogExercise['movement']['mechanic'];
}

/**
 * Evaluates one candidate against every hard constraint: not already used
 * elsewhere in the plan (duplicate prevention, docs §51), operationally
 * available, movement-purpose preserved, equipment/environment executable,
 * and limitation-safe. Safety and structural equivalence are resolved here,
 * before any novelty/history ranking ever runs (docs §21/§28).
 */
export function evaluateEquivalenceCandidate(input: {
  source: LimitationCatalogExercise;
  candidateId: string;
  catalog: ReadonlyMap<string, LimitationCatalogExercise>;
  regions: readonly LimitationRegionId[];
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
      candidate.movement.pattern !== input.slotContext.sourceMovementPattern
      || candidate.movement.mechanic !== input.slotContext.sourceMechanic
    )
  ) reasonCodes.push('SESSION_CONTEXT_MISMATCH');
  if (candidate && !isExerciseExecutable(candidate, input.equipmentContext)) reasonCodes.push('EQUIPMENT_UNAVAILABLE');
  if (candidate && !isLimitationSafe(candidate, input.regions)) reasonCodes.push('LIMITATION_INCOMPATIBLE');
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

/**
 * Ranks only already-eligible candidates. Priority: an explicitly declared
 * similar exercise, then not-recently-used (anti-ping-pong penalty, never a
 * hard exclusion — docs §36), then closest difficulty. Ties break on a
 * stable hash salted by `tieBreakSalt` (normally `targetCycleIdentity` +
 * slot key) so the same cycle always re-resolves identically while a
 * different target cycle can legitimately choose differently (docs §32/§33).
 */
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
