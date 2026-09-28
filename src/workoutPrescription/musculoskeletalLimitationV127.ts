import { CANONICAL_ACTIVITIES } from './canonicalActivities';
import { MUSCULOSKELETAL_LIMITATION_REGIONS_V127, type MusculoskeletalLimitationRegionV127 } from './canonicalMusculoskeletalLimitationV127';
import { isExerciseExecutable, unrestrictedEquipmentContext } from './equipment';
import {
  resolveExerciseLimitationsFromCandidates,
  validateLimitationProfile,
  type LimitationCandidateOrigin,
  type LimitationCatalog,
  type LimitationCatalogExercise,
  type RankedLimitationCandidateEvaluation,
} from './limitationResolver';
import { loadLocalExerciseCatalogForLimitations } from './localLimitationCatalog';
import type { FinalWorkoutExercise, FinalWorkoutSession, TemplateEnvironment } from './types';
import type { LimitationRegionId } from '../types/exercise';

export type { MusculoskeletalLimitationRegionV127 };

/**
 * Rewrite (exercise-substitution architecture audit — "reuse the app's own
 * equivalence source, not a second one"). The pre-rewrite version of this
 * module read v1.27's own `exercise_substitution_map`/`avoid_by_default`
 * JSON (`canonicalMusculoskeletalLimitationV127.ts`) — a template-authoring
 * dataset that was never reviewed against, or kept in sync with, the ONE
 * per-exercise clinical dataset the rest of the app already trusts
 * (`limitationProfile`, `docs/workout-modifiers/exercise-limitations/
 * 15_LIMITATION_PROFILES_TECHNICAL_v2.json`). A full 714-combination audit
 * (102 templates x 7 regions) proved that JSON-map/tier design structurally
 * blocks knee/hip/spine/shoulder in 100% of templates: its only Tier A
 * candidates are either never catalogued (`proposed_catalog_addition`) or
 * are themselves avoid-listed for the same region, and its Tier B/C dose
 * policy requires a "substitute-specific authoritative reps/intensity
 * source" that never exists anywhere in the dataset — an invented safety
 * concept with no analog anywhere else in the app.
 *
 * This rewrite deletes that second universe. It resolves every
 * musculoskeletal substitution through `resolveExerciseLimitationsFromCandidates`
 * (`limitationResolver.ts`) — the EXACT function `composition.ts` already
 * calls, today, for every real v2 user's automatic prescription-time
 * limitation substitution. Candidate discovery, ranking, and safety
 * (`purposePreserved` pattern+muscle equivalence, `validateLimitationProfile`
 * against EVERY active region, `isExerciseExecutable` environment gate,
 * self/duplicate exclusion, fail-closed `NO_SAFE_SUBSTITUTION`) are 100%
 * shared with that production code path — nothing here re-implements or
 * forks any of it.
 *
 * Dose: audited across every consumer of exercise substitution in this app
 * (`composition.ts`'s own limitation substitution, `manualSubstitutionResolver.ts`'s
 * user-triggered swap, `prescriptionEvolution/cycleEvolution.ts`'s cycle
 * evolution, `workoutExecution/types.ts`'s `buildInitialExerciseExecutions`)
 * — none of them EVER recompute sets/reps/duration/distance/cycles/
 * cycleRange/intensity/notes when the exercise identity in a slot changes.
 * Dose is a property of the SLOT (what the session prescribes), never of
 * which specific exercise fills it. There is no "authoritative
 * substitute-specific dose" concept anywhere in the app to reuse beyond
 * that — so there is no `CANDIDATE_UNSAFE_DOSE` gate here; every accepted
 * substitution carries the original slot's dose forward verbatim, exactly
 * like every other substitution path in the app already does.
 */

const LEGACY_REGION_BY_V127: Record<MusculoskeletalLimitationRegionV127, LimitationRegionId> = {
  knee: 'knee',
  hip: 'hip',
  spine: 'back',
  shoulder: 'shoulder',
  elbow: 'elbow',
  wrist: 'wrist',
  ankle_foot: 'ankle_foot',
};

function toLegacyRegions(regions: readonly MusculoskeletalLimitationRegionV127[]): LimitationRegionId[] {
  return regions.map((region) => LEGACY_REGION_BY_V127[region]);
}

/**
 * Coverage is evaluated PER ACTIVE REGION, never globally: an exercise's
 * `limitationProfile` may have an already-reviewed decision for one region
 * and a `pending` (not yet reviewed) one for another — the resolver must
 * only ever require a decision for the region(s) actually active for this
 * user, never for the other 6.
 *
 * This check exists ALONGSIDE `resolveExerciseLimitationsFromCandidates`'s
 * own per-region `sourceTerminal` check (which already only inspects the
 * active regions) because that function's candidate search
 * (`similarExerciseIds`/`substitution.group` family) runs UNCONDITIONALLY,
 * regardless of the source's own rule status for the active region — a
 * `pending` region would otherwise fall through to that search and could
 * silently accept a family-matched candidate for a region nobody ever
 * actually reviewed (e.g. `cable-crossover-fly`'s `chest_fly` group already
 * contains `pec-deck-machine-fly`). `pending` must never behave like an
 * undeclared `avoid` — it must fail closed immediately, exactly like a
 * missing profile, without ever reaching candidate search.
 */
function hasPendingActiveRegion(
  profile: unknown,
  exerciseId: string,
  activeLegacyRegions: readonly LimitationRegionId[],
): boolean {
  const validation = validateLimitationProfile(exerciseId, profile);
  if (!validation.valid) return false; // handled by resolveExerciseLimitationsFromCandidates's own PROFILE_COVERAGE_MISSING path.
  return activeLegacyRegions.some((region) => validation.profile.regions[region].status === 'pending');
}

/**
 * Cardio/mobility activities (`CANONICAL_ACTIVITIES`) are a disjoint,
 * non-Firestore-backed catalog with no `limitationProfile` concept at all
 * (same exclusion the real limitation resolver already applies elsewhere —
 * they are not in `EXERCISES_SEED`/`LimitationCatalog` in the first place).
 * They are exempt from substitution entirely, same as before the rewrite.
 */
const CANONICAL_ACTIVITY_IDS: ReadonlySet<string> = new Set(CANONICAL_ACTIVITIES.map((activity) => activity.id));

/**
 * The same bundled, pure, local `EXERCISES_SEED` + reviewed-`limitationProfile`
 * merge already sanctioned for production runtime use (see
 * `localLimitationCatalog.ts`'s file doc) — one shared catalog, not a
 * v1.27-specific copy.
 */
const SHARED_LIMITATION_CATALOG: LimitationCatalog = new Map(
  loadLocalExerciseCatalogForLimitations().map((exercise) => [exercise.id, exercise]),
);

type DoseFieldsV127 = Pick<FinalWorkoutExercise, 'sets' | 'reps' | 'duration' | 'distance' | 'cycles' | 'cycleRange' | 'intensity' | 'notes'>;

function doseSnapshot(exercise: DoseFieldsV127): DoseFieldsV127 {
  return {
    sets: exercise.sets,
    reps: exercise.reps,
    duration: exercise.duration,
    distance: exercise.distance,
    cycles: exercise.cycles,
    cycleRange: exercise.cycleRange,
    intensity: exercise.intensity,
    notes: exercise.notes,
  };
}

export type MusculoskeletalLimitationDecisionV127 =
  | {
      sessionIndex: number;
      exerciseId: string;
      activeRegions: MusculoskeletalLimitationRegionV127[];
      outcome: 'SUBSTITUTED';
      substituteExerciseId: string;
      /** Which lane of the app's OWN existing equivalence source resolved this — never a v1.27-specific tier. 'original' never appears here (that outcome is not logged as a decision at all — see the module doc). */
      candidateOrigin: LimitationCandidateOrigin;
      candidateRank: number;
      sourcePrimaryMuscle: string;
      substitutePrimaryMuscle: string;
      environment: TemplateEnvironment;
      /** 'adapted' when the source's own declared `adapt` rule resolved it; 'substituted' when an `avoid` rule (or the similar/family pool) did. */
      limitationProfileResolution: 'adapted' | 'substituted';
      doseBefore: DoseFieldsV127;
      doseAfter: DoseFieldsV127;
      candidatesEvaluated: RankedLimitationCandidateEvaluation[];
    }
  | {
      sessionIndex: number;
      exerciseId: string;
      activeRegions: MusculoskeletalLimitationRegionV127[];
      outcome: 'BLOCKED';
      reasonCode: 'NO_SAFE_SUBSTITUTION' | 'PROFILE_COVERAGE_MISSING';
      /** The exact `limitationResolver.ts`/`validateLimitationProfile` reason codes behind `PROFILE_COVERAGE_MISSING` (e.g. `LIMITATION_PROFILE_MISSING`) — never merged with substitution-failure reasoning. */
      sourceReasonCodes: string[];
      candidatesEvaluated: RankedLimitationCandidateEvaluation[];
    };

export type MusculoskeletalLimitationResultV127 =
  | { status: 'APPLIED'; sessions: FinalWorkoutSession[]; decisions: MusculoskeletalLimitationDecisionV127[] }
  | { status: 'BLOCKED'; reasonCodes: string[]; decisions: MusculoskeletalLimitationDecisionV127[] };

export interface MusculoskeletalLimitationDataV127 {
  catalog: LimitationCatalog;
  isExecutable: (exercise: LimitationCatalogExercise) => boolean;
}

function defaultDataFor(environment: TemplateEnvironment): MusculoskeletalLimitationDataV127 {
  const equipmentContext = unrestrictedEquipmentContext(environment);
  return {
    catalog: SHARED_LIMITATION_CATALOG,
    isExecutable: (exercise) => isExerciseExecutable(exercise, equipmentContext),
  };
}

/**
 * `data` defaults to the real shared catalog/environment gate — injectable
 * only for unit tests that need a precise, synthetic catalog (same pattern
 * as the rest of this directory, e.g. `selectBaseTemplateV127`'s `catalog`
 * param).
 */
export function applyMusculoskeletalLimitationV127(
  sessions: readonly FinalWorkoutSession[],
  environment: TemplateEnvironment,
  activeRegions: readonly MusculoskeletalLimitationRegionV127[],
  data: MusculoskeletalLimitationDataV127 = defaultDataFor(environment),
): MusculoskeletalLimitationResultV127 {
  if (!activeRegions.length) {
    // Nothing active — every exercise is returned by identity, matching
    // Fase 4's "no context => byte-identical" invariant exactly.
    return { status: 'APPLIED', sessions: sessions as FinalWorkoutSession[], decisions: [] };
  }

  const legacyRegions = toLegacyRegions(activeRegions);
  const activeRegionsSnapshot = [...activeRegions];
  const decisions: MusculoskeletalLimitationDecisionV127[] = [];
  const reasonCodes: string[] = [];

  const resultSessions: FinalWorkoutSession[] = sessions.map((session, sessionIndex) => {
    const usedInSession = new Set<string>();
    let sessionChanged = false;
    const finalExercises: FinalWorkoutExercise[] = session.exercises.map((exercise) => {
      const originalRuntimeId = exercise.exerciseId;

      if (CANONICAL_ACTIVITY_IDS.has(originalRuntimeId)) {
        usedInSession.add(originalRuntimeId);
        return exercise;
      }

      if (hasPendingActiveRegion(data.catalog.get(originalRuntimeId)?.limitationProfile, originalRuntimeId, legacyRegions)) {
        decisions.push({
          sessionIndex,
          exerciseId: originalRuntimeId,
          activeRegions: activeRegionsSnapshot,
          outcome: 'BLOCKED',
          reasonCode: 'PROFILE_COVERAGE_MISSING',
          sourceReasonCodes: ['LIMITATION_REGION_PENDING'],
          candidatesEvaluated: [],
        });
        reasonCodes.push(`MUSCULOSKELETAL_PROFILE_COVERAGE_MISSING:${sessionIndex}:${originalRuntimeId}`);
        usedInSession.add(originalRuntimeId);
        return exercise;
      }

      const resolution = resolveExerciseLimitationsFromCandidates({
        exerciseId: originalRuntimeId,
        regions: legacyRegions,
        catalog: data.catalog,
        isExecutable: data.isExecutable,
        excludedExerciseIds: usedInSession,
      });

      if (resolution.status === 'FAILED') {
        const reasonCode = resolution.failureKind === 'INVALID_CONFIGURATION' ? 'PROFILE_COVERAGE_MISSING' : 'NO_SAFE_SUBSTITUTION';
        decisions.push({
          sessionIndex,
          exerciseId: originalRuntimeId,
          activeRegions: activeRegionsSnapshot,
          outcome: 'BLOCKED',
          reasonCode,
          sourceReasonCodes: resolution.reasonCodes,
          candidatesEvaluated: resolution.candidatesEvaluated,
        });
        reasonCodes.push(
          reasonCode === 'PROFILE_COVERAGE_MISSING'
            ? `MUSCULOSKELETAL_PROFILE_COVERAGE_MISSING:${sessionIndex}:${originalRuntimeId}`
            : `MUSCULOSKELETAL_NO_SUBSTITUTE:${sessionIndex}:${originalRuntimeId}`,
        );
        usedInSession.add(originalRuntimeId);
        return exercise;
      }

      usedInSession.add(resolution.exercise.id);

      // 'original' = the source itself is already compatible with every
      // active region — Fase 5 §1's "copy through unchanged, same object
      // reference" guarantee, no decision logged (matches the pre-rewrite
      // contract: only an actual substitution or a block is ever traced).
      if (resolution.candidateOrigin === 'original') {
        return exercise;
      }

      sessionChanged = true;
      // `LimitationDecisionTrace.candidatesEvaluated` is typed narrowly
      // (`LimitationCandidateEvaluation[]`), but `resolveExerciseLimitationsFromCandidates`
      // always populates it with the richer ranked shape (see its own
      // `rankedEvaluation = { ...evaluation, origin, rank }` push) — this
      // reflects that real runtime shape, not a new assumption.
      const candidatesEvaluated = (resolution.trace.candidatesEvaluated ?? []) as RankedLimitationCandidateEvaluation[];
      const acceptedEvaluation = candidatesEvaluated.find(
        (candidate) => candidate.exerciseId === resolution.exercise.id,
      );
      const dose = doseSnapshot(exercise);
      decisions.push({
        sessionIndex,
        exerciseId: originalRuntimeId,
        activeRegions: activeRegionsSnapshot,
        outcome: 'SUBSTITUTED',
        substituteExerciseId: resolution.exercise.id,
        candidateOrigin: resolution.candidateOrigin,
        candidateRank: acceptedEvaluation?.rank ?? 0,
        sourcePrimaryMuscle: data.catalog.get(originalRuntimeId)?.target.primaryMuscle ?? '',
        substitutePrimaryMuscle: resolution.exercise.target.primaryMuscle,
        environment,
        limitationProfileResolution: resolution.trace.resolution === 'adapted' ? 'adapted' : 'substituted',
        doseBefore: dose,
        doseAfter: dose,
        candidatesEvaluated,
      });
      return {
        exerciseId: resolution.exercise.id,
        sourceExerciseId: exercise.sourceExerciseId,
        sets: exercise.sets,
        reps: exercise.reps,
        duration: exercise.duration,
        cycles: exercise.cycles,
        cycleRange: exercise.cycleRange,
        distance: exercise.distance,
        intensity: exercise.intensity,
        notes: exercise.notes,
      };
    });

    // No vetoed exercise in this session at all: return the SAME session
    // object (not a copy) — the strongest possible "unaffected session
    // stays byte-identical" guarantee.
    if (!sessionChanged && finalExercises.every((exercise, index) => exercise === session.exercises[index])) {
      return session;
    }
    return { ...session, exercises: finalExercises };
  });

  if (reasonCodes.length) {
    return { status: 'BLOCKED', reasonCodes: [...new Set(reasonCodes)].sort(), decisions };
  }
  return { status: 'APPLIED', sessions: resultSessions, decisions };
}

export { MUSCULOSKELETAL_LIMITATION_REGIONS_V127 };
