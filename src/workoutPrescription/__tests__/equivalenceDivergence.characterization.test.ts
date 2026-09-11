import { describe, expect, it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { equipmentContextFor } from '../equipment';
import { evaluateDirectLimitationCandidate, resolveExerciseLimitationsFromCandidates, validateLimitationProfile, type LimitationCatalogExercise } from '../limitationResolver';
import { candidatePoolFor, evaluateEquivalenceCandidate, isLimitationSafe } from '../../prescriptionEvolution/equivalence';
import { completeAnswers, realLimitationCatalogFixture } from './fixtures';

/**
 * Exercise-substitution architecture audit (Fase 1): these tests freeze real,
 * currently-existing behavior differences between `limitationResolver.ts` and
 * `prescriptionEvolution/equivalence.ts` that must NOT be silently unified by
 * any future refactor. If one of these tests starts failing, it means a
 * change altered one motor's observable behavior — stop and reconcile with a
 * product/engineering decision instead of "fixing" the test.
 */

const catalog = new Map<string, LimitationCatalogExercise>(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));
const limitationCatalog = new Map<string, LimitationCatalogExercise>(
  realLimitationCatalogFixture().map((exercise) => [exercise.id, exercise]),
);

function get(id: string): LimitationCatalogExercise {
  const exercise = catalog.get(id);
  if (!exercise) throw new Error(`fixture exercise missing: ${id}`);
  return exercise;
}

describe('DIVERGENCE: regions=[] short-circuit vs explicit safety check', () => {
  it('isLimitationSafe (equivalence.ts) returns true for regions=[] without ever inspecting limitationProfile', () => {
    const noProfile = { ...get('barbell-back-squat'), limitationProfile: undefined };
    expect(isLimitationSafe(noProfile, [])).toBe(true);
  });

  it('evaluateDirectLimitationCandidate (limitationResolver.ts) still runs validateLimitationProfile even when the caller passes regions=[]', () => {
    const noProfile = { ...get('barbell-back-squat'), limitationProfile: undefined };
    const validation = validateLimitationProfile(noProfile.id, noProfile.limitationProfile);
    expect(validation.valid).toBe(false);
    // Direct call with regions=[] never pushes a region-status reason code
    // (the `for` loop has nothing to iterate), but the function signature
    // still takes `regions` as a candidate-level input, not a whole-call
    // short-circuit like isLimitationSafe's `if (regions.length === 0) return true`.
    // This is only invisible in production because
    // `resolveExerciseLimitationsFromCandidates` short-circuits BEFORE ever
    // calling this function when `regions.length === 0` (next test).
    const evaluation = evaluateDirectLimitationCandidate({
      source: noProfile,
      candidateId: noProfile.id,
      regions: [],
      catalog,
      isExecutable: () => true,
      visitedExerciseIds: new Set(),
    });
    // Not rejected for a region-status reason (there are none to check), but
    // this function alone does NOT special-case an invalid/missing profile
    // away — it simply has nothing to complain about for zero regions.
    expect(evaluation.reasonCodes.some((code) => code.startsWith('LIMITATION_CANDIDATE_'))).toBe(false);
  });

  it('resolveExerciseLimitationsFromCandidates fails closed on a missing/invalid SOURCE limitationProfile even when regions=[] — the real, opposite-direction divergence from isLimitationSafe', () => {
    // Correction from an earlier hypothesis: `resolveExerciseLimitationsFromCandidates`
    // validates the source's own `limitationProfile` UNCONDITIONALLY, before
    // `regions` is ever consulted (limitationResolver.ts's `validateLimitationProfile`
    // call precedes the `sourceTerminal` vacuous-truth check). So with
    // regions=[] and an invalid/missing source profile, this resolver FAILS —
    // the exact opposite of isLimitationSafe(candidate, []), which always
    // returns true regardless of profile validity when regions is empty.
    // Any future unification must decide, explicitly, which of these two
    // "regions=[] " behaviors the shared safety gate should have; this test
    // freezes limitationResolver.ts's current (fail-closed) one.
    const noProfile = { ...get('barbell-back-squat'), limitationProfile: undefined };
    const localCatalog = new Map(catalog);
    localCatalog.set(noProfile.id, noProfile);
    const result = resolveExerciseLimitationsFromCandidates({
      exerciseId: noProfile.id,
      regions: [],
      catalog: localCatalog,
      isExecutable: () => true,
    });
    expect(result.status).toBe('FAILED');
    if (result.status === 'FAILED') expect(result.reasonCodes).toContain('LIMITATION_PROFILE_MISSING');
  });
});

describe('DIVERGENCE: ROLE_MISMATCH (movement.mechanic) is Evolution-only, not universal', () => {
  it('equivalence.ts rejects a mechanic-mismatched candidate declared in similarExerciseIds (real dataset regression: hip-thrust -> cable-glute-kickback)', () => {
    const source = get('hip-thrust');
    const candidate = get('cable-glute-kickback');
    expect(source.movement.mechanic).toBe('compound');
    expect(candidate.movement.mechanic).toBe('isolation');
    const equipmentContext = equipmentContextFor(completeAnswers({ place: 'gym' }), 'gym');
    const evaluation = evaluateEquivalenceCandidate({
      source, candidateId: candidate.id, catalog, regions: [], equipmentContext,
      usedExerciseIds: new Set(), recentExerciseIds: new Set(),
    });
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reasonCodes).toContain('ROLE_MISMATCH');
  });

  it('limitationResolver.ts has NO equivalent mechanic-equality gate for "declared"/"similar"/"preferred" origins — only "family" origin enforces same mechanic', () => {
    // rankedLimitationCandidates only requires `candidate.movement.mechanic === source.movement.mechanic`
    // for the `family` origin (same substitution.group + same pattern + same mechanic).
    // Candidates surfaced via `declared` (avoid.substituteExerciseIds) or
    // `similar` (substitution.similarExerciseIds) or `preferred` (adapt rule)
    // are NEVER filtered by mechanic inside evaluateDirectLimitationCandidate —
    // its reason codes are purpose/profile/region/equipment only, never a
    // mechanic check. This test documents that absence directly: a
    // mechanic-mismatched pair reachable only via `declared`/`similar` would
    // be ACCEPTED here where equivalence.ts would reject it via ROLE_MISMATCH.
    const evaluation = evaluateDirectLimitationCandidate({
      source: get('hip-thrust'),
      candidateId: 'cable-glute-kickback',
      regions: [],
      catalog: limitationCatalog,
      isExecutable: () => true,
      visitedExerciseIds: new Set(),
    });
    // No LIMITATION_CANDIDATE_* reason code exists for a mechanic mismatch —
    // confirms the absence of any such gate in this function's reason-code
    // vocabulary (see limitationResolver.ts's evaluateDirectLimitationCandidate).
    expect(evaluation.reasonCodes.every((code) => !code.toLowerCase().includes('mechanic') && !code.toLowerCase().includes('role'))).toBe(true);
  });
});

describe('DIVERGENCE: candidate pool origins — equivalence.ts is a strict subset of limitationResolver.ts', () => {
  it('equivalence.ts candidatePoolFor never surfaces a limitationVariantIds candidate that purposePreserved would accept via the "explicitlyApprovedVariant" branch', () => {
    // rankedLimitationCandidates (limitationResolver.ts) draws from 4 origins:
    // preferred (adapt rule) -> declared (avoid.substituteExerciseIds +
    // limitationVariantIds) -> similar (substitution.similarExerciseIds) ->
    // family (same group+pattern+mechanic). candidatePoolFor (equivalence.ts)
    // draws from only 2: similarExerciseIds + family. This asymmetry is
    // intentional (Evolution never resolves a clinical `adapt`/`avoid` rule,
    // Prescription/Adaptation do) but must never be silently equalized.
    const sourceWithVariant = [...catalog.values()].find(
      (exercise) => (exercise.substitution.limitationVariantIds?.length ?? 0) > 0,
    );
    expect(sourceWithVariant).toBeDefined();
    if (!sourceWithVariant) return;
    const variantId = sourceWithVariant.substitution.limitationVariantIds![0];
    const pool = candidatePoolFor(sourceWithVariant, catalog);
    // A variant reachable ONLY via limitationVariantIds (never declared in
    // similarExerciseIds and not in the same substitution.group/pattern/
    // mechanic family) is invisible to equivalence.ts's pool — even though
    // limitationResolver.ts's rankedLimitationCandidates would surface it
    // under the `declared` origin.
    const alsoDeclaredElsewhere = sourceWithVariant.substitution.similarExerciseIds.includes(variantId)
      || sourceWithVariant.substitution.group === catalog.get(variantId)?.substitution.group;
    if (!alsoDeclaredElsewhere) expect(pool).not.toContain(variantId);
  });
});
