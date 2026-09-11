import type { LimitationRegionId } from '../types/exercise';
import {
  validateLimitationProfile,
  type LimitationCatalog,
  type LimitationCatalogExercise,
  type LimitationReasonCode,
} from './limitationResolver';
import { DIFFICULTY_RANK, purposePreserved } from './equivalenceShared';
import { isExerciseExecutable, type EquipmentContext } from './equipment';

/**
 * Manual Substitution candidate resolver (exercise-substitution architecture
 * audit). A NEW, narrowly-scoped consumer of the shared equivalence
 * primitives (`purposePreserved`, `DIFFICULTY_RANK`, `isExerciseExecutable`,
 * `validateLimitationProfile`) — deliberately NOT a third independent
 * equivalence engine. Reuses the exact same building blocks as
 * `limitationResolver.ts` (Prescription/Adaptation) and
 * `prescriptionEvolution/equivalence.ts` (Evolution), but applies its own
 * consumer-specific policy where the audit found those two motors already
 * disagree (mechanic/ROLE_MISMATCH), plus a policy neither of them needs:
 * excluding exercises already effectively present elsewhere in the CURRENT
 * runtime session.
 *
 * Architectural pattern follows `equivalence.ts`'s (not `limitationResolver.ts`'s):
 * candidate discovery -> evaluate ALL candidates -> keep eligible -> rank the
 * full eligible set -> caller slices top-N. `limitationResolver.ts`'s
 * ranks-before-validates-and-stops-at-first-winner shape cannot produce a
 * top-3 list without changing its own (Prescription/Adaptation) observable
 * behavior, so it is intentionally not reused here (see the audit's Section 8
 * on ranking architecture).
 */

export type ManualSubstitutionReasonCode =
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_NOT_AVAILABLE_FOR_MANUAL_SUBSTITUTION'
  | 'PURPOSE_MISMATCH'
  | 'ROLE_MISMATCH'
  | 'EQUIPMENT_UNAVAILABLE'
  | LimitationReasonCode
  | `LIMITATION_INCOMPATIBLE:${LimitationRegionId}`
  | 'DUPLICATE_IN_SESSION'
  | 'SAME_AS_ANCHOR';

export interface ManualSubstitutionCandidateEvaluation {
  exerciseId: string;
  eligible: boolean;
  reasonCodes: ManualSubstitutionReasonCode[];
  declaredSimilar: boolean;
  /**
   * True only when this candidate's `movement.mechanic` differs from the
   * anchor's but was still accepted because it is an explicitly declared
   * `limitationVariantIds` entry — the dataset-declared, safety/adaptation
   * escape valve from Decision #1. Never true for an ordinary candidate.
   */
  mechanicExceptionApplied: boolean;
  difficultyDistance: number;
  lateralityMatch: boolean;
}

export interface ManualSubstitutionResolutionInput {
  /** The exercise originally prescribed for this slot — NEVER the currently effective (possibly already-substituted) one. Decision #5: no chaining, always resolved against this fixed anchor. */
  anchorExerciseId: string;
  catalog: LimitationCatalog;
  regions: readonly LimitationRegionId[];
  equipmentContext: EquipmentContext;
  /** Exercise ids effectively resolved in every OTHER slot of the current session (post-substitution) — never the anchor's own slot. */
  effectiveExerciseIdsInSession: ReadonlySet<string>;
  maxResults?: number;
}

export type ManualSubstitutionResolutionResult =
  | { status: 'INVALID_ANCHOR' }
  | { status: 'NO_ELIGIBLE_CANDIDATES'; evaluated: ManualSubstitutionCandidateEvaluation[] }
  | { status: 'RESOLVED'; candidates: ManualSubstitutionCandidateEvaluation[]; evaluated: ManualSubstitutionCandidateEvaluation[] };

/**
 * Full `substitution.group` + same movement pattern universe, scanning the
 * whole catalog exactly like `rankedLimitationCandidates`/`candidatePoolFor`
 * already do for their own "family" origin — NEVER limited to the dataset's
 * pre-cut `similarExerciseIds` (audit Section 8/10: `buildSubstitutions()`'s
 * `.slice(0, 4)` discards real candidates, e.g. `bodyweight-squat`/
 * `goblet-squat`/`chair-squat` from `quad_squat`, before any contextual
 * filter ever runs). Mechanic is intentionally NOT filtered at pool-build
 * time — the `limitationVariantIds` safety exception needs a mechanic
 * mismatch to still reach evaluation; the mechanic policy is enforced only
 * in `evaluateManualSubstitutionCandidate`.
 */
function buildManualSubstitutionCandidatePool(
  source: LimitationCatalogExercise,
  catalog: LimitationCatalog,
): Set<string> {
  const pool = new Set<string>();
  for (const id of source.substitution.similarExerciseIds) pool.add(id);
  for (const id of source.substitution.limitationVariantIds ?? []) pool.add(id);
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
  source: LimitationCatalogExercise;
  candidateId: string;
  catalog: LimitationCatalog;
  regions: readonly LimitationRegionId[];
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
      mechanicExceptionApplied: false,
      difficultyDistance: Number.POSITIVE_INFINITY,
      lateralityMatch: false,
    };
  }

  if (candidate.status !== 'active' || !candidate.availability.manualSelection || !candidate.availability.substitution) {
    reasonCodes.push('CANDIDATE_NOT_AVAILABLE_FOR_MANUAL_SUBSTITUTION');
  }
  if (!purposePreserved(input.source, candidate)) reasonCodes.push('PURPOSE_MISMATCH');

  // Decision #1: normal manual substitution requires the same movement.mechanic
  // (equivalence.ts's ROLE_MISMATCH policy — stricter than limitationResolver.ts,
  // which only enforces mechanic for its "family" origin). The single declared
  // exception: an explicitly approved `limitationVariantIds` entry, which is
  // already the dataset's own escape valve for safety/adaptation-driven
  // cross-muscle variants (see `purposePreserved`'s `explicitlyApprovedVariant`).
  const isDeclaredLimitationVariant = input.source.substitution.limitationVariantIds?.includes(candidate.id) ?? false;
  const mechanicMatches = candidate.movement.mechanic === input.source.movement.mechanic;
  const mechanicExceptionApplied = !mechanicMatches && isDeclaredLimitationVariant;
  if (!mechanicMatches && !isDeclaredLimitationVariant) reasonCodes.push('ROLE_MISMATCH');

  if (!isExerciseExecutable(candidate, input.equipmentContext)) reasonCodes.push('EQUIPMENT_UNAVAILABLE');

  if (input.regions.length > 0) {
    const validation = validateLimitationProfile(candidate.id, candidate.limitationProfile);
    if (!validation.valid) reasonCodes.push(validation.reasonCode);
    else {
      for (const region of input.regions) {
        const status = validation.profile.regions[region].status;
        if (status !== 'compatible' && status !== 'not_applicable') {
          reasonCodes.push(`LIMITATION_INCOMPATIBLE:${region}`);
        }
      }
    }
  }

  return {
    exerciseId: input.candidateId,
    eligible: reasonCodes.length === 0,
    reasonCodes,
    declaredSimilar: input.source.substitution.similarExerciseIds.includes(input.candidateId),
    mechanicExceptionApplied,
    difficultyDistance: Math.abs(DIFFICULTY_RANK[candidate.difficulty] - DIFFICULTY_RANK[input.source.difficulty]),
    lateralityMatch: candidate.movement.laterality === input.source.movement.laterality,
  };
}

/**
 * Ranks only already-eligible candidates. No hash/salt is needed for
 * determinism (unlike Evolution's cross-cycle anti-ping-pong ranking) — the
 * final tie-break is a plain lexicographic `exerciseId` compare, which alone
 * already makes the order fully independent of `Map`/catalog iteration order.
 * Priority: declared-similar first, then an ordinary (non-exception)
 * mechanic match, then closest difficulty, then matching laterality.
 */
export function rankManualSubstitutionCandidates(
  evaluations: readonly ManualSubstitutionCandidateEvaluation[],
): ManualSubstitutionCandidateEvaluation[] {
  const eligible = evaluations.filter((evaluation) => evaluation.eligible);
  return [...eligible].sort((a, b) => {
    const tupleA = [
      a.declaredSimilar ? 0 : 1,
      a.mechanicExceptionApplied ? 1 : 0,
      a.difficultyDistance,
      a.lateralityMatch ? 0 : 1,
    ];
    const tupleB = [
      b.declaredSimilar ? 0 : 1,
      b.mechanicExceptionApplied ? 1 : 0,
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

/**
 * Top-level entry point: candidate discovery -> evaluate all -> keep eligible
 * -> rank -> caller-controlled top-N (default 3, per product Decision #4 —
 * never pads with an ineligible candidate to force exactly 3).
 */
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
      regions: input.regions,
      equipmentContext: input.equipmentContext,
      effectiveExerciseIdsInSession: input.effectiveExerciseIdsInSession,
    }));

  const ranked = rankManualSubstitutionCandidates(evaluated);
  if (ranked.length === 0) return { status: 'NO_ELIGIBLE_CANDIDATES', evaluated };
  const maxResults = input.maxResults ?? MANUAL_SUBSTITUTION_DEFAULT_MAX_RESULTS;
  return { status: 'RESOLVED', candidates: ranked.slice(0, maxResults), evaluated };
}

/**
 * "Voltar ao original" (Decision #5/UX section): validates reverting a slot
 * back to its anchor exercise against the SAME safety/equipment/duplicate
 * gates as any other candidate — reverting is never assumed automatically
 * safe just because it was the original prescription (equipment/limitation
 * may have changed since). Purpose preservation is not checked (the anchor
 * trivially preserves its own purpose).
 */
export function evaluateRevertToAnchor(input: {
  anchorExerciseId: string;
  catalog: LimitationCatalog;
  regions: readonly LimitationRegionId[];
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
  if (input.regions.length > 0) {
    const validation = validateLimitationProfile(source.id, source.limitationProfile);
    if (!validation.valid) reasonCodes.push(validation.reasonCode);
    else {
      for (const region of input.regions) {
        const status = validation.profile.regions[region].status;
        if (status !== 'compatible' && status !== 'not_applicable') {
          reasonCodes.push(`LIMITATION_INCOMPATIBLE:${region}`);
        }
      }
    }
  }
  return { eligible: reasonCodes.length === 0, reasonCodes };
}

/**
 * Permanent-preference materialization at execution CREATION time (Fase
 * "Todos os próximos treinos" gap fix). Pure — no Firestore, no time source
 * of its own (the caller supplies already-loaded preferences/context, and a
 * concrete `appliedAt` timestamp value goes on the RESULT, computed by the
 * caller, never here). Resume of an EXISTING execution must never call this
 * — it only runs once, right before `buildInitialExerciseExecutions`, at the
 * moment a brand-new (or restarted-after-abandon) execution is created.
 *
 * Collision rule (product decision): processed in slot order. The FIRST slot
 * whose preference resolves to a given exerciseId keeps it; any LATER slot
 * whose own preference would resolve to that same (now taken) exerciseId
 * falls back to ITS OWN prescribed exercise — never to a third alternative
 * the user didn't choose, and never left unresolved.
 */
export function resolvePermanentSubstitutionsForSession(input: {
  /** Prescribed exerciseId per slot, in session order — the FinalWorkoutPlan's own ids, never mutated. */
  sessionExerciseIds: readonly string[];
  /** prescribedExerciseId -> user's preferred replacement, as persisted in `exerciseSubstitutionPreferences`. */
  preferences: ReadonlyMap<string, string>;
  catalog: LimitationCatalog;
  regions: readonly LimitationRegionId[];
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
      regions: input.regions,
      equipmentContext: input.equipmentContext,
      effectiveExerciseIdsInSession: effectiveElsewhere,
    });
    // Invalid (limitation/equipment/availability/duplicate-in-session, incl.
    // the A->X / B->X collision above) -> fall back to the prescribed
    // exercise. Never substitutes a third candidate on the user's behalf —
    // they chose this specific preferredExerciseId, not "any safe swap".
    if (!evaluation.eligible) continue;
    effective[index] = preferredExerciseId;
    resolved.set(index, preferredExerciseId);
  }
  return resolved;
}
