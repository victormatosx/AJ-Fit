import { describe, expect, it } from 'vitest';

import { getCanonicalTemplateV127ById } from '../canonicalCatalog';
import { composeTemplateV127 } from '../compositionV127';
import { MUSCULOSKELETAL_LIMITATION_REGIONS_V127 } from '../canonicalMusculoskeletalLimitationV127';
import {
  applyMusculoskeletalLimitationV127,
  type MusculoskeletalLimitationDataV127,
} from '../musculoskeletalLimitationV127';
import { isExerciseExecutable, unrestrictedEquipmentContext } from '../equipment';
import type { LimitationCatalog, LimitationCatalogExercise } from '../limitationResolver';
import type { FinalWorkoutExercise, FinalWorkoutSession, TemplateEnvironment } from '../types';

/**
 * Rewrite (exercise-substitution architecture audit). This suite now proves
 * `applyMusculoskeletalLimitationV127` against its NEW contract: every
 * substitution is resolved through the SAME shared equivalence/limitation
 * engine (`resolveExerciseLimitationsFromCandidates`, `limitationResolver.ts`)
 * that `composition.ts` already uses for real v2 users — there is no more
 * v1.27-only A/B/C tier system, no `exercise_substitution_map`, and no
 * invented `CANDIDATE_UNSAFE_DOSE` gate (see the module's own file doc for
 * the full rationale). Every invariant the pre-rewrite suite covered is
 * re-proven here against real catalog data (multi-region intersection,
 * environment gym/home compatibility, self/duplicate rejection,
 * `limitationProfile` fail-closed behavior, verbatim dose transfer,
 * untouched-session byte-identity) plus the new ones the rewrite adds
 * (candidate provenance/origin, primaryMuscle before/after, dose before/after).
 */

const GYM: TemplateEnvironment = 'gym';
const HOME: TemplateEnvironment = 'home';

function exercise(id: string, overrides: Partial<FinalWorkoutExercise> = {}): FinalWorkoutExercise {
  return { exerciseId: id, sourceExerciseId: id, ...overrides } as FinalWorkoutExercise;
}
function session(exercises: FinalWorkoutExercise[], name = 'Sessão'): FinalWorkoutSession {
  return { name, exercises } as FinalWorkoutSession;
}

/** A minimal synthetic catalog for tests that need precise, hand-authored candidates rather than real EXERCISES_SEED data. */
function syntheticCatalogEntry(overrides: {
  id: string;
  primaryMuscle?: string;
  pattern?: string;
  mechanic?: string;
  laterality?: 'unilateral' | 'bilateral';
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  equipment?: string[];
  group?: string;
  similarExerciseIds?: string[];
  limitationVariantIds?: string[];
  regions?: Partial<Record<(typeof MUSCULOSKELETAL_LIMITATION_REGIONS_V127)[number] | 'back', unknown>>;
}): LimitationCatalogExercise {
  const regionKeys = ['knee', 'hip', 'back', 'shoulder', 'elbow', 'wrist', 'ankle_foot'] as const;
  const regions: Record<string, unknown> = {};
  for (const key of regionKeys) {
    regions[key] = overrides.regions?.[key as keyof typeof overrides.regions] ?? { status: 'compatible' };
  }
  return {
    id: overrides.id,
    slug: overrides.id,
    name: { ptBR: overrides.id, en: overrides.id, es: overrides.id },
    status: 'active',
    target: { primaryMuscle: overrides.primaryMuscle ?? 'quads', secondaryMuscles: [] },
    movement: {
      pattern: overrides.pattern ?? 'squat',
      mechanic: overrides.mechanic ?? 'compound',
      laterality: overrides.laterality ?? 'bilateral',
    },
    equipment: overrides.equipment ?? ['bodyweight'],
    bodyPosition: 'standing',
    difficulty: overrides.difficulty ?? 'intermediate',
    instructions: { ptBR: [], en: [], es: [] },
    availability: { workoutGeneration: true, manualSelection: true, substitution: true },
    substitution: {
      group: overrides.group,
      similarExerciseIds: overrides.similarExerciseIds ?? [],
      limitationVariantIds: overrides.limitationVariantIds,
    },
    limitationProfile: {
      schemaVersion: 1,
      protocolVersion: 'musculoskeletal-v1',
      reviewStatus: 'approved',
      reviewBasis: 'product_policy',
      regions,
    },
  } as unknown as LimitationCatalogExercise;
}

function syntheticData(entries: LimitationCatalogExercise[], environment: TemplateEnvironment = GYM): MusculoskeletalLimitationDataV127 {
  const catalog: LimitationCatalog = new Map(entries.map((entry) => [entry.id, entry]));
  const equipmentContext = unrestrictedEquipmentContext(environment);
  return { catalog, isExecutable: (ex) => isExerciseExecutable(ex, equipmentContext) };
}

// ---------------------------------------------------------------------------
// 1. No active region: byte-identical passthrough
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — no active region', () => {
  it('returns the exact same sessions array (and same session objects) when no region is active', () => {
    const sessions = [session([exercise('leg-press-45'), exercise('barbell-back-squat')])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, []);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions).toBe(sessions as unknown as FinalWorkoutSession[]);
    expect(result.decisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Real-data proof: the shared limitation resolver, not a v1.27-only map
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — real data, resolved through the shared limitation resolver', () => {
  it('leg-press-45 + knee substitutes via the exercise\'s own reviewed `adapt` rule (chair-sit-to-stand) — the exact scenario that was structurally unresolvable pre-rewrite', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('leg-press-45', { sets: 3, reps: '8-12' })])], GYM, ['knee']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0]).toMatchObject({ exerciseId: 'chair-sit-to-stand', sourceExerciseId: 'leg-press-45', sets: 3, reps: '8-12' });
    expect(result.decisions).toEqual([expect.objectContaining({
      exerciseId: 'leg-press-45', outcome: 'SUBSTITUTED', substituteExerciseId: 'chair-sit-to-stand',
      candidateOrigin: 'preferred', limitationProfileResolution: 'adapted',
      sourcePrimaryMuscle: 'quads', substitutePrimaryMuscle: 'quads',
    })]);
  });

  it('farmers-walk is reviewed "compatible" with elbow in the app\'s own limitationProfile — stays unchanged, no decision logged, even though it used to be avoid-listed in the deleted v1.27-only JSON', () => {
    const original = exercise('farmers-walk', { sets: 3, distance: '20-40 m' });
    const sessions = [session([original])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['elbow']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0]).toBe(original);
    expect(result.decisions).toEqual([]);
  });

  it('an exercise with no reviewed limitationProfile at all fails closed as PROFILE_COVERAGE_MISSING, distinct from a substitution failure', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('totally-unknown-exercise-id')])], GYM, ['knee']);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.reasonCodes).toEqual(['MUSCULOSKELETAL_PROFILE_COVERAGE_MISSING:0:totally-unknown-exercise-id']);
    expect(result.decisions[0]).toMatchObject({ outcome: 'BLOCKED', reasonCode: 'PROFILE_COVERAGE_MISSING' });
  });

  it('cardio/mobility activities are exempt from the limitation pipeline entirely (no limitationProfile concept applies to them)', () => {
    const original = exercise('cardio-leve', { duration: '20-30 min' });
    const result = applyMusculoskeletalLimitationV127([session([original])], GYM, ['knee']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0]).toBe(original);
    expect(result.decisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Multiple active regions — intersection, not union of exclusions
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — multiple active regions (candidate must clear ALL of them)', () => {
  it('a candidate compatible with knee but avoid-listed for spine is rejected; a candidate compatible with both is accepted', () => {
    const source = syntheticCatalogEntry({ id: 'source-ex', group: 'g', pattern: 'p', mechanic: 'compound' });
    const kneeOnlyUnsafe = syntheticCatalogEntry({
      id: 'candidate-knee-ok-spine-bad', group: 'g', pattern: 'p', mechanic: 'compound',
      regions: { back: { status: 'avoid', substituteExerciseIds: [], candidateStatus: 'missing_exercise_candidate' } },
    });
    const safeForBoth = syntheticCatalogEntry({ id: 'candidate-safe-both', group: 'g', pattern: 'p', mechanic: 'compound' });
    // family pool discovery requires the source to declare the group; give it declared candidates directly instead for determinism.
    const sourceWithDeclared = syntheticCatalogEntry({
      id: 'source-ex', group: 'g', pattern: 'p', mechanic: 'compound',
      similarExerciseIds: ['candidate-knee-ok-spine-bad', 'candidate-safe-both'],
      regions: {
        knee: { status: 'avoid', substituteExerciseIds: ['candidate-knee-ok-spine-bad', 'candidate-safe-both'], candidateStatus: 'ready' },
      },
    });
    const data = syntheticData([sourceWithDeclared, kneeOnlyUnsafe, safeForBoth]);
    const result = applyMusculoskeletalLimitationV127([session([exercise('source-ex')])], GYM, ['knee', 'spine'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0].exerciseId).toBe('candidate-safe-both');
    void source;
  });

  it('fails closed when every candidate is safe for one active region but not all of them', () => {
    const onlyCandidate = syntheticCatalogEntry({
      id: 'only-candidate', group: 'g', pattern: 'p', mechanic: 'compound',
      regions: { back: { status: 'avoid', substituteExerciseIds: [], candidateStatus: 'missing_exercise_candidate' } },
    });
    const source = syntheticCatalogEntry({
      id: 'source-ex', group: 'g', pattern: 'p', mechanic: 'compound',
      regions: { knee: { status: 'avoid', substituteExerciseIds: ['only-candidate'], candidateStatus: 'ready' } },
    });
    const data = syntheticData([source, onlyCandidate]);
    const result = applyMusculoskeletalLimitationV127([session([exercise('source-ex')])], GYM, ['knee', 'spine'], data);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.reasonCodes).toEqual(['MUSCULOSKELETAL_NO_SUBSTITUTE:0:source-ex']);
  });
});

// ---------------------------------------------------------------------------
// 4. Environment (Gym/Home) — same compatibility model as the normal app
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — environment compatibility (same isExerciseExecutable gate the rest of the app uses)', () => {
  it('a candidate requiring gym-only equipment is rejected in a Home session', () => {
    const source = syntheticCatalogEntry({
      id: 'home-source', group: 'g', pattern: 'p', mechanic: 'compound', equipment: ['bodyweight'],
      regions: { knee: { status: 'avoid', substituteExerciseIds: ['gym-only-candidate', 'home-ok-candidate'], candidateStatus: 'ready' } },
    });
    const gymOnly = syntheticCatalogEntry({ id: 'gym-only-candidate', group: 'g', pattern: 'p', mechanic: 'compound', equipment: ['leg_press'] });
    const homeOk = syntheticCatalogEntry({ id: 'home-ok-candidate', group: 'g', pattern: 'p', mechanic: 'compound', equipment: ['dumbbell'] });
    const data = syntheticData([source, gymOnly, homeOk], HOME);
    const result = applyMusculoskeletalLimitationV127([session([exercise('home-source')])], HOME, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0].exerciseId).toBe('home-ok-candidate');
  });

  it('gym sessions never reject a candidate purely on equipment (same permissive gym rule the rest of the app already applies)', () => {
    const source = syntheticCatalogEntry({
      id: 'gym-source', group: 'g', pattern: 'p', mechanic: 'compound',
      regions: { knee: { status: 'avoid', substituteExerciseIds: ['heavy-machine-candidate'], candidateStatus: 'ready' } },
    });
    const heavyMachine = syntheticCatalogEntry({ id: 'heavy-machine-candidate', group: 'g', pattern: 'p', mechanic: 'compound', equipment: ['leg_press', 'hack_machine'] });
    const data = syntheticData([source, heavyMachine], GYM);
    const result = applyMusculoskeletalLimitationV127([session([exercise('gym-source')])], GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0].exerciseId).toBe('heavy-machine-candidate');
  });
});

// ---------------------------------------------------------------------------
// 5. Equivalence — same movement pattern + primary muscle, never arbitrary
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — equivalence is preserved (purposePreserved: same pattern + muscle, never "any safe exercise")', () => {
  it('a safe but different-pattern/muscle candidate is never chosen just because it is safe', () => {
    const source = syntheticCatalogEntry({
      id: 'quad-source', primaryMuscle: 'quads', pattern: 'squat', mechanic: 'compound', group: 'g',
      regions: { knee: { status: 'avoid', substituteExerciseIds: ['unrelated-safe-candidate'], candidateStatus: 'ready' } },
    });
    // Safe for knee, but a completely different pattern/muscle (arm curl) — must NOT be accepted despite being "safe".
    const unrelated = syntheticCatalogEntry({ id: 'unrelated-safe-candidate', primaryMuscle: 'biceps', pattern: 'elbow_flexion', mechanic: 'isolation' });
    const data = syntheticData([source, unrelated]);
    const result = applyMusculoskeletalLimitationV127([session([exercise('quad-source')])], GYM, ['knee'], data);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.decisions[0]).toMatchObject({ outcome: 'BLOCKED', reasonCode: 'NO_SAFE_SUBSTITUTION' });
  });

  it('real data: leg-press-45 (quads/squat) only ever resolves to another quads/squat-pattern exercise, never an unrelated body part', () => {
    const result = applyMusculoskeletalLimitationV127([session([exercise('leg-press-45')])], GYM, ['knee']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    const decision = result.decisions[0];
    expect(decision).toMatchObject({ outcome: 'SUBSTITUTED', sourcePrimaryMuscle: 'quads', substitutePrimaryMuscle: 'quads' });
  });
});

// ---------------------------------------------------------------------------
// 6. Self and duplicate rejection
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — self and duplicate-in-session rejection', () => {
  it('the original exercise itself is never offered back as its own substitute', () => {
    // barbell-back-squat's own `similarExerciseIds` never contains itself (validated catalog-wide elsewhere); prove the
    // resolver still can't loop back to source even if a synthetic catalog tried to declare it.
    const source = syntheticCatalogEntry({
      id: 'loop-source', group: 'g', pattern: 'p', mechanic: 'compound',
      similarExerciseIds: ['loop-source'],
      regions: { knee: { status: 'avoid', substituteExerciseIds: ['loop-source'], candidateStatus: 'ready' } },
    });
    const data = syntheticData([source]);
    const result = applyMusculoskeletalLimitationV127([session([exercise('loop-source')])], GYM, ['knee'], data);
    expect(result.status).toBe('BLOCKED');
  });

  it('a candidate already used earlier in the same session is rejected, forcing the next ranked candidate', () => {
    const a = syntheticCatalogEntry({
      id: 'source-a', group: 'g', pattern: 'p', mechanic: 'compound',
      regions: { knee: { status: 'avoid', substituteExerciseIds: ['shared-candidate'], candidateStatus: 'ready' } },
    });
    const b = syntheticCatalogEntry({
      id: 'source-b', group: 'g', pattern: 'p', mechanic: 'compound',
      regions: { knee: { status: 'avoid', substituteExerciseIds: ['shared-candidate', 'fallback-candidate'], candidateStatus: 'ready' } },
    });
    const shared = syntheticCatalogEntry({ id: 'shared-candidate', group: 'g', pattern: 'p', mechanic: 'compound' });
    const fallback = syntheticCatalogEntry({ id: 'fallback-candidate', group: 'g', pattern: 'p', mechanic: 'compound' });
    const data = syntheticData([a, b, shared, fallback]);
    // Both a and b are vetoed and both declare shared-candidate first; a claims it, b must fall through.
    const result = applyMusculoskeletalLimitationV127([session([exercise('source-a'), exercise('source-b')])], GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0].exerciseId).toBe('shared-candidate');
    expect(result.sessions[0].exercises[1].exerciseId).toBe('fallback-candidate');
  });

  it('real data: duplicate-in-session forces leg-press-45 past its preferred chair-sit-to-stand (already claimed by barbell-back-squat) to a different, still-safe family candidate', () => {
    const result = applyMusculoskeletalLimitationV127(
      [session([exercise('barbell-back-squat'), exercise('leg-press-45')])], GYM, ['knee'],
    );
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    const [first, second] = result.sessions[0].exercises;
    expect(first.exerciseId).toBe('chair-sit-to-stand');
    expect(second.exerciseId).not.toBe('chair-sit-to-stand');
    expect(second.exerciseId).not.toBe('leg-press-45');
    // The second decision's rejected-candidate trace proves WHY: chair-sit-to-stand was visited.
    const secondDecision = result.decisions.find((d) => d.exerciseId === 'leg-press-45');
    expect(secondDecision?.outcome).toBe('SUBSTITUTED');
    if (secondDecision?.outcome !== 'SUBSTITUTED') return;
    expect(secondDecision.candidatesEvaluated.find((c) => c.exerciseId === 'chair-sit-to-stand')).toMatchObject({
      accepted: false, reasonCodes: ['LIMITATION_CANDIDATE_VISITED'],
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Dose is transferred verbatim — no invented CANDIDATE_UNSAFE_DOSE gate
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — dose transfers verbatim (same rule composition.ts/manualSubstitutionResolver.ts/cycleEvolution already use)', () => {
  it('every dose field (sets/reps/duration/distance/cycles/cycleRange/intensity/notes) is copied unchanged onto the substitute, regardless of how "different" the substitute is', () => {
    const original = exercise('leg-press-45', {
      sets: 4, reps: '6-10', intensity: 'alta', notes: 'nota de execução',
    });
    const result = applyMusculoskeletalLimitationV127([session([original])], GYM, ['knee']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0]).toMatchObject({
      exerciseId: 'chair-sit-to-stand', sets: 4, reps: '6-10', intensity: 'alta', notes: 'nota de execução',
    });
    const decision = result.decisions[0];
    expect(decision.outcome).toBe('SUBSTITUTED');
    if (decision.outcome !== 'SUBSTITUTED') return;
    expect(decision.doseBefore).toEqual(decision.doseAfter);
    expect(decision.doseBefore).toMatchObject({ sets: 4, reps: '6-10', intensity: 'alta', notes: 'nota de execução' });
  });

  it('a duration/distance-based exercise transfers those fields unchanged too — no reps/intensity concept forced onto it', () => {
    const original = exercise('leg-press-45', { sets: 3, duration: '45 s', distance: undefined });
    const result = applyMusculoskeletalLimitationV127([session([original])], GYM, ['knee']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0]).toMatchObject({ sets: 3, duration: '45 s' });
    expect(result.sessions[0].exercises[0].reps).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Blast radius: only the vetoed exercise/session changes
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — scoped blast radius', () => {
  const source = syntheticCatalogEntry({
    id: 'vetoed-source', group: 'g', pattern: 'p', mechanic: 'compound',
    regions: { knee: { status: 'avoid', substituteExerciseIds: ['safe-candidate'], candidateStatus: 'ready' } },
  });
  const candidate = syntheticCatalogEntry({ id: 'safe-candidate', group: 'g', pattern: 'p', mechanic: 'compound' });
  const bystander = syntheticCatalogEntry({ id: 'bystander', primaryMuscle: 'lats', pattern: 'pull', mechanic: 'compound' });
  const data = syntheticData([source, candidate, bystander]);

  it('only the vetoed exercise in the vetoed session changes; every other exercise/session is untouched (same object reference)', () => {
    const untouchedInSameSession = exercise('bystander');
    const vetoed = exercise('vetoed-source');
    const otherSession = session([exercise('bystander')], 'Sessão intacta');
    const sessions = [session([vetoed, untouchedInSameSession], 'Sessão afetada'), otherSession];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[1]).toBe(otherSession);
    expect(result.sessions[0].name).toBe('Sessão afetada');
    expect(result.sessions[0].exercises[1]).toBe(untouchedInSameSession);
    expect(result.sessions[0].exercises[0].exerciseId).toBe('safe-candidate');
  });

  it('a session with no vetoed exercise at all is returned by the exact same object reference', () => {
    const untouched = session([exercise('bystander')]);
    const result = applyMusculoskeletalLimitationV127([untouched], GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0]).toBe(untouched);
  });
});

// ---------------------------------------------------------------------------
// 9. Seven regions — at least one representative real-data case each
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — real data, one representative case per region (post-rewrite: most now resolve instead of fail closed)', () => {
  const representative: Record<(typeof MUSCULOSKELETAL_LIMITATION_REGIONS_V127)[number], { id: string; expectSubstituted: boolean }> = {
    knee: { id: 'leg-press-45', expectSubstituted: true },
    hip: { id: 'leg-press-45', expectSubstituted: true },
    spine: { id: 'leg-press-45', expectSubstituted: true },
    shoulder: { id: 'dumbbell-lateral-raise', expectSubstituted: true },
    elbow: { id: 'dumbbell-overhead-triceps-extension', expectSubstituted: true },
    wrist: { id: 'ez-bar-biceps-curl', expectSubstituted: true },
    ankle_foot: { id: 'bench-step-up', expectSubstituted: true },
  };

  it.each(MUSCULOSKELETAL_LIMITATION_REGIONS_V127)('region "%s" resolves its representative real exercise deterministically', (region) => {
    const { id, expectSubstituted } = representative[region];
    const result = applyMusculoskeletalLimitationV127([session([exercise(id, { sets: 3, reps: '8-12' })])], GYM, [region]);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    const decision = result.decisions[0];
    if (expectSubstituted) {
      expect(decision).toBeDefined();
      expect(decision.outcome).toBe('SUBSTITUTED');
    }
  });
});

// ---------------------------------------------------------------------------
// composeTemplateV127 integration — the Fase 5 stage actually wires in
// ---------------------------------------------------------------------------

describe('composeTemplateV127 — musculoskeletal_limitation stage integration', () => {
  it('T001 with no limitationRegions composes identically to the Fase 4 baseline', () => {
    const template = getCanonicalTemplateV127ById('T001');
    const withoutContext = composeTemplateV127(template);
    const withEmptyRegions = composeTemplateV127(template, { limitationRegions: [] });
    expect(withoutContext.status).toBe('COMPOSED');
    expect(withEmptyRegions.status).toBe('COMPOSED');
    if (withoutContext.status !== 'COMPOSED' || withEmptyRegions.status !== 'COMPOSED') return;
    expect(withoutContext.sessions).toEqual(withEmptyRegions.sessions);
    expect(withoutContext.trace.musculoskeletalLimitationApplied).toBe(false);
    expect(withoutContext.trace.stagesApplied).not.toContain('musculoskeletal_limitation');
  });

  it('accepts the legacy `back` region id and normalizes it to `spine` at the v1.27 boundary — both produce the exact same composition', () => {
    const template = getCanonicalTemplateV127ById('T025');
    const withBack = composeTemplateV127(template, { limitationRegions: ['back'] });
    const withSpine = composeTemplateV127(template, { limitationRegions: ['spine'] });
    expect(withBack).toEqual(withSpine);
    expect(withBack.trace.musculoskeletalLimitationApplied).toBe(true);
    expect(withBack.status).toBe('COMPOSED');
  });

  it('T025 with elbow active substitutes real exercises through the shared resolver and marks the stage as applied', () => {
    const template = getCanonicalTemplateV127ById('T025');
    const result = composeTemplateV127(template, { limitationRegions: ['elbow'] });
    expect(result.status).toBe('COMPOSED');
    if (result.status !== 'COMPOSED') return;
    expect(result.trace.musculoskeletalLimitationApplied).toBe(true);
    expect(result.trace.stagesApplied).toEqual(['musculoskeletal_limitation']);
    expect(result.trace.limitationDecisions.length).toBeGreaterThan(0);
    expect(result.trace.limitationDecisions.every((d) => d.outcome === 'SUBSTITUTED')).toBe(true);
  });

  it('resolves the former T009 hip collision through the reviewed low-step fallback', () => {
    const template = getCanonicalTemplateV127ById('T009');
    const result = composeTemplateV127(template, { limitationRegions: ['hip'] });
    expect(result.status).toBe('COMPOSED');
    if (result.status !== 'COMPOSED') return;
    expect(result.trace.limitationDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        exerciseId: 'bench-step-up', outcome: 'SUBSTITUTED', substituteExerciseId: 'low-step-up',
      }),
    ]));
  });
});
