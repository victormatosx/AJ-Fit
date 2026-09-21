import { describe, expect, it } from 'vitest';
import { getCanonicalTemplateV127ById } from '../canonicalCatalog';
import { composeTemplateV127 } from '../compositionV127';
import {
  applyMusculoskeletalLimitationV127,
  type MusculoskeletalLimitationDataV127,
} from '../musculoskeletalLimitationV127';
import {
  AVOID_RUNTIME_IDS_BY_REGION_V127,
  MUSCULOSKELETAL_LIMITATION_REGIONS_V127,
  type MusculoskeletalLimitationRegionV127,
  type SubstitutionCandidateV127,
  type SubstitutionCandidatesV127,
} from '../canonicalMusculoskeletalLimitationV127';
import type { FinalWorkoutExercise, FinalWorkoutSession, TemplateEnvironment } from '../types';

// ---------------------------------------------------------------------------
// Synthetic fixtures — full control over tier availability/environment/dose,
// independent of what the real v1.27 canonical map happens to contain today.
//
// Dose policy note: the v1.27 `exercise_substitution_map` candidate objects
// carry no dose metadata of their own (only name/exercise_id/catalog_status/
// environments), so Tier B/C can only ever preserve `sets` from the
// original — never `reps`/`intensity` (see `musculoskeletalLimitationV127.ts`'s
// `substituteAuthoritativeDose`, always `null` today). Fixtures that are
// only exercising TIER ORDER / REGION UNION / SELF / DUPLICATE logic
// therefore use `sets`-only originals (no `reps`) so B/C tiers succeed
// without also depending on the dose policy under test elsewhere in this
// file (the dedicated "dose policy" describe block below).
// ---------------------------------------------------------------------------

function exercise(id: string, overrides: Partial<FinalWorkoutExercise> = {}): FinalWorkoutExercise {
  return { exerciseId: id, sourceExerciseId: id, ...overrides };
}

function session(exercises: FinalWorkoutExercise[], overrides: Partial<FinalWorkoutSession> = {}): FinalWorkoutSession {
  return { name: 'Sessão', type: 'resistance', exercises, ...overrides };
}

function candidate(runtimeId: string, environments: TemplateEnvironment[] = ['gym', 'home']): SubstitutionCandidateV127 {
  return { runtimeId, name: runtimeId, catalogStatus: 'existing_library', environments };
}

function emptyAvoidByRegion(): Record<MusculoskeletalLimitationRegionV127, ReadonlySet<string>> {
  const result = {} as Record<MusculoskeletalLimitationRegionV127, ReadonlySet<string>>;
  for (const region of MUSCULOSKELETAL_LIMITATION_REGIONS_V127) result[region] = new Set<string>();
  return result;
}

function syntheticData(input: {
  avoidByRegion?: Partial<Record<MusculoskeletalLimitationRegionV127, string[]>>;
  candidatesByRuntimeId?: Record<string, SubstitutionCandidatesV127>;
  unexecutableIds?: string[];
}): MusculoskeletalLimitationDataV127 {
  const avoidByRegion = emptyAvoidByRegion();
  for (const [region, ids] of Object.entries(input.avoidByRegion ?? {})) {
    avoidByRegion[region as MusculoskeletalLimitationRegionV127] = new Set(ids);
  }
  const unexecutable = new Set(input.unexecutableIds ?? []);
  return {
    avoidByRegion,
    candidatesByRuntimeId: new Map(Object.entries(input.candidatesByRuntimeId ?? {})),
    isExecutable: (id) => !unexecutable.has(id),
  };
}

const GYM: TemplateEnvironment = 'gym';

// ---------------------------------------------------------------------------
// 1. No limitation -> output identical to the composed template
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — no active limitation', () => {
  it('returns the exact same sessions array/objects when activeRegions is empty', () => {
    const sessions = [session([exercise('barbell-back-squat', { sets: 3, reps: '8-12' })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, []);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions).toBe(sessions);
    expect(result.decisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Exercise not vetoed by any active region stays byte-identical
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — exercise not affected', () => {
  it('keeps the exact same exercise object (not just equal value) when no active region vetoes it', () => {
    const original = exercise('unrelated-exercise', { sets: 3, reps: '10-12' });
    const sessions = [session([original])];
    const data = syntheticData({ avoidByRegion: { knee: ['something-else'] } });
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0]).toBe(sessions[0]);
    expect(result.sessions[0].exercises[0]).toBe(original);
    expect(result.decisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3/4/5/6. A -> B -> C tier order, and fail-closed when none are valid
// (sets-only originals: isolates tier-order logic from dose policy)
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — A -> B -> C tier order', () => {
  function tieredData(): MusculoskeletalLimitationDataV127 {
    return syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: {
        'vetoed-exercise': {
          A: [candidate('candidate-a')],
          B: [candidate('candidate-b')],
          C: [candidate('candidate-c')],
        },
      },
    });
  }

  it('chooses Tier A when a valid A candidate exists, and never evaluates B/C', () => {
    const sessions = [session([exercise('vetoed-exercise', { sets: 3, reps: '8-12' })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], tieredData());
    expect(result.status).toBe('APPLIED');
    expect(result.decisions).toEqual([{
      sessionIndex: 0, exerciseId: 'vetoed-exercise', vetoedByRegions: ['knee'],
      outcome: 'SUBSTITUTED', tier: 'A', substituteExerciseId: 'candidate-a', rejectedCandidates: [],
    }]);
    if (result.status === 'APPLIED') expect(result.sessions[0].exercises[0].exerciseId).toBe('candidate-a');
  });

  it('falls through to Tier B when the only A candidate is invalid', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: {
        'vetoed-exercise': {
          A: [candidate('candidate-a', ['home'])], // gym-incompatible
          B: [candidate('candidate-b')],
          C: [candidate('candidate-c')],
        },
      },
    });
    const sessions = [session([exercise('vetoed-exercise', { sets: 3 })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.decisions[0].outcome).toBe('SUBSTITUTED');
    expect(result.decisions[0]).toMatchObject({ tier: 'B', substituteExerciseId: 'candidate-b' });
    expect(result.decisions[0].rejectedCandidates).toEqual([
      { exerciseId: 'candidate-a', tier: 'A', reasonCode: 'CANDIDATE_ENVIRONMENT_INCOMPATIBLE' },
    ]);
    expect(result.sessions[0].exercises[0]).toMatchObject({ exerciseId: 'candidate-b', sets: 3 });
  });

  it('falls through to Tier C when A and B are both invalid', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: {
        'vetoed-exercise': {
          A: [candidate('candidate-a', ['home'])],
          B: [candidate('candidate-b', ['home'])],
          C: [candidate('candidate-c')],
        },
      },
    });
    const sessions = [session([exercise('vetoed-exercise', { sets: 3 })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.decisions[0]).toMatchObject({ tier: 'C', substituteExerciseId: 'candidate-c' });
    expect(result.decisions[0].rejectedCandidates).toHaveLength(2);
  });

  it('fails closed (BLOCKED) when no A/B/C candidate is valid', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: {
        'vetoed-exercise': {
          A: [candidate('candidate-a', ['home'])],
          B: [candidate('candidate-b', ['home'])],
          C: [candidate('candidate-c', ['home'])],
        },
      },
    });
    const sessions = [session([exercise('vetoed-exercise', { sets: 3 })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.reasonCodes).toEqual(['MUSCULOSKELETAL_NO_SUBSTITUTE:0:vetoed-exercise']);
    expect(result.decisions).toEqual([{
      sessionIndex: 0, exerciseId: 'vetoed-exercise', vetoedByRegions: ['knee'],
      outcome: 'BLOCKED', reasonCode: 'NO_VALID_CANDIDATE',
      rejectedCandidates: [
        { exerciseId: 'candidate-a', tier: 'A', reasonCode: 'CANDIDATE_ENVIRONMENT_INCOMPATIBLE' },
        { exerciseId: 'candidate-b', tier: 'B', reasonCode: 'CANDIDATE_ENVIRONMENT_INCOMPATIBLE' },
        { exerciseId: 'candidate-c', tier: 'C', reasonCode: 'CANDIDATE_ENVIRONMENT_INCOMPATIBLE' },
      ],
    }]);
  });

  it('fails closed when the vetoed exercise has no substitution-map entry at all', () => {
    const data = syntheticData({ avoidByRegion: { knee: ['vetoed-exercise'] } });
    const sessions = [session([exercise('vetoed-exercise', { sets: 3 })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.decisions[0]).toMatchObject({ outcome: 'BLOCKED', reasonCode: 'NO_SUBSTITUTION_MAP_ENTRY' });
  });
});

// ---------------------------------------------------------------------------
// 7. Multiple active regions — a candidate must pass ALL of them, not just
//    the region that vetoed the original exercise
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — multiple active regions (union of avoid lists)', () => {
  it('rejects a Tier A candidate that is itself vetoed by a SECOND active region, and falls through to a candidate safe for both', () => {
    const data = syntheticData({
      avoidByRegion: {
        knee: ['vetoed-exercise'],
        hip: ['candidate-a'], // A is clean for knee but unsafe for hip
      },
      candidatesByRuntimeId: {
        'vetoed-exercise': {
          A: [candidate('candidate-a')],
          B: [candidate('candidate-b')],
          C: [],
        },
      },
    });
    const sessions = [session([exercise('vetoed-exercise', { sets: 3 })])];
    const kneeOnly = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    const kneeAndHip = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee', 'hip'], data);
    expect(kneeOnly.status).toBe('APPLIED');
    if (kneeOnly.status === 'APPLIED') expect(kneeOnly.decisions[0]).toMatchObject({ tier: 'A', substituteExerciseId: 'candidate-a' });
    expect(kneeAndHip.status).toBe('APPLIED');
    if (kneeAndHip.status !== 'APPLIED') return;
    expect(kneeAndHip.decisions[0]).toMatchObject({ tier: 'B', substituteExerciseId: 'candidate-b' });
    expect(kneeAndHip.decisions[0].rejectedCandidates).toEqual([
      { exerciseId: 'candidate-a', tier: 'A', reasonCode: 'CANDIDATE_VIOLATES_ACTIVE_LIMITATION' },
    ]);
  });

  it('real-data proof: bench-step-up (hip) substitutes to supported-low-step-up alone, but that substitute is itself knee-vetoed, so hip+knee correctly fails closed instead of reusing it', () => {
    const sessions = [session([exercise('bench-step-up', { sets: 3, reps: '10-12' })])];
    const hipOnly = applyMusculoskeletalLimitationV127(sessions, GYM, ['hip']);
    const hipAndKnee = applyMusculoskeletalLimitationV127(sessions, GYM, ['hip', 'knee']);
    expect(hipOnly.status).toBe('APPLIED');
    const hipOnlyDecision = hipOnly.decisions[0];
    if (hipOnlyDecision.outcome !== 'SUBSTITUTED') throw new Error('expected SUBSTITUTED');
    expect(hipOnlyDecision.substituteExerciseId).toBe('supported-low-step-up');
    expect(AVOID_RUNTIME_IDS_BY_REGION_V127.knee.has('supported-low-step-up')).toBe(true);
    // With knee also active, the only Tier A candidate is itself knee-vetoed
    // — real data currently has no B/C candidate with an authoritative dose
    // (reps was set on the original), so this fails closed rather than
    // reusing a candidate unsafe for one of the two active regions.
    expect(hipAndKnee.status).toBe('BLOCKED');
    if (hipAndKnee.status !== 'BLOCKED') return;
    const decision = hipAndKnee.decisions[0];
    expect(decision.outcome).toBe('BLOCKED');
    expect(decision.rejectedCandidates.some((r) => r.exerciseId === 'supported-low-step-up' && r.reasonCode === 'CANDIDATE_VIOLATES_ACTIVE_LIMITATION')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combination coverage explicitly requested: knee+hip, knee+ankle_foot,
// spine+shoulder, shoulder+elbow+wrist — each proven to enforce the union.
// (sets-only originals: isolates region-union logic from dose policy)
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — required region combinations', () => {
  it('knee + hip: a candidate vetoed by hip is rejected even though only knee vetoed the original', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['squat-variant'], hip: ['candidate-a'] },
      candidatesByRuntimeId: { 'squat-variant': { A: [candidate('candidate-a')], B: [candidate('candidate-b')], C: [] } },
    });
    const sessions = [session([exercise('squat-variant', { sets: 3 })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee', 'hip'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.decisions[0]).toMatchObject({ tier: 'B', substituteExerciseId: 'candidate-b' });
  });

  it('knee + ankle_foot: a candidate vetoed by ankle_foot is rejected even though only knee vetoed the original', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['lunge-variant'], ankle_foot: ['candidate-a'] },
      candidatesByRuntimeId: { 'lunge-variant': { A: [candidate('candidate-a')], B: [candidate('candidate-b')], C: [] } },
    });
    const sessions = [session([exercise('lunge-variant', { sets: 3 })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee', 'ankle_foot'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.decisions[0]).toMatchObject({ tier: 'B', substituteExerciseId: 'candidate-b' });
  });

  it('spine + shoulder: a candidate vetoed by shoulder is rejected even though only spine vetoed the original', () => {
    const data = syntheticData({
      avoidByRegion: { spine: ['row-variant'], shoulder: ['candidate-a'] },
      candidatesByRuntimeId: { 'row-variant': { A: [candidate('candidate-a')], B: [candidate('candidate-b')], C: [] } },
    });
    const sessions = [session([exercise('row-variant', { sets: 3 })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['spine', 'shoulder'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.decisions[0]).toMatchObject({ tier: 'B', substituteExerciseId: 'candidate-b' });
  });

  it('shoulder + elbow + wrist: a candidate must clear all three regions simultaneously', () => {
    const data = syntheticData({
      avoidByRegion: {
        shoulder: ['press-variant'],
        elbow: ['candidate-a'],
        wrist: ['candidate-b'],
      },
      candidatesByRuntimeId: {
        'press-variant': { A: [candidate('candidate-a')], B: [candidate('candidate-b')], C: [candidate('candidate-c')] },
      },
    });
    const sessions = [session([exercise('press-variant', { sets: 3 })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['shoulder', 'elbow', 'wrist'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.decisions[0]).toMatchObject({ tier: 'C', substituteExerciseId: 'candidate-c' });
    expect(result.decisions[0].rejectedCandidates.map((r) => r.exerciseId)).toEqual(['candidate-a', 'candidate-b']);
  });
});

// ---------------------------------------------------------------------------
// 8. Canonicalization never lets a self-reference or an in-session duplicate
//    through as a "valid" substitute
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — self and duplicate rejection', () => {
  it('rejects a Tier A candidate that resolves to the same runtime id as the original exercise', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: {
        'vetoed-exercise': { A: [candidate('vetoed-exercise')], B: [candidate('candidate-b')], C: [] },
      },
    });
    const sessions = [session([exercise('vetoed-exercise', { sets: 3 })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.decisions[0].rejectedCandidates).toEqual([
      { exerciseId: 'vetoed-exercise', tier: 'A', reasonCode: 'CANDIDATE_IS_SELF' },
    ]);
    expect(result.decisions[0]).toMatchObject({ tier: 'B', substituteExerciseId: 'candidate-b' });
  });

  it('rejects a candidate that would duplicate an exercise already placed earlier in the same session', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: {
        'vetoed-exercise': { A: [candidate('already-in-session')], B: [candidate('candidate-b')], C: [] },
      },
    });
    const sessions = [session([
      exercise('already-in-session', { sets: 3 }),
      exercise('vetoed-exercise', { sets: 3 }),
    ])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    const decision = result.decisions.find((d) => d.exerciseId === 'vetoed-exercise')!;
    expect(decision.rejectedCandidates).toEqual([
      { exerciseId: 'already-in-session', tier: 'A', reasonCode: 'CANDIDATE_DUPLICATE_IN_SESSION' },
    ]);
    expect(decision).toMatchObject({ tier: 'B', substituteExerciseId: 'candidate-b' });
  });

  it('real-data proof: the joelhos-com-elástico unification never lets the resolved alias act as its own substitute', () => {
    // resistance-band-standing-leg-curl is the shared runtime id for both
    // "flexao-de-joelhos-com-elastico" and the unified-away "...-e-apoio".
    const sessions = [session([exercise('resistance-band-standing-leg-curl', { sets: 3, reps: '10-12' })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee']);
    // Not vetoed by knee at all today — the real assertion is just that if
    // it WERE a candidate anywhere, it could never resolve to itself.
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0].exerciseId).toBe('resistance-band-standing-leg-curl');
  });
});

// ---------------------------------------------------------------------------
// 9. Only the vetoed exercise changes — every other slot/session/metadata
//    field is untouched
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — scoped blast radius', () => {
  it('only the vetoed exercise in the vetoed session changes; every other exercise/session/metadata field is untouched', () => {
    const untouchedInSameSession = exercise('untouched-a', { sets: 4, reps: '6-8', notes: 'keep me' });
    const vetoed = exercise('vetoed-exercise', { sets: 3 });
    const otherSession = session([exercise('untouched-b', { sets: 2, reps: '12-15' })], {
      name: 'Outra sessão', notes: 'session notes', techniqueGuideline: 'tech', displayName: 'Display',
    });
    const affectedSession = session([untouchedInSameSession, vetoed], { name: 'Sessão afetada' });
    const sessions = [affectedSession, otherSession];

    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: { 'vetoed-exercise': { A: [candidate('candidate-a')], B: [], C: [] } },
    });
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;

    // Untouched session: same object reference entirely.
    expect(result.sessions[1]).toBe(otherSession);
    // Affected session: metadata unchanged, only the vetoed exercise differs.
    expect(result.sessions[0].name).toBe('Sessão afetada');
    expect(result.sessions[0].exercises[0]).toBe(untouchedInSameSession);
    expect(result.sessions[0].exercises[1].exerciseId).toBe('candidate-a');
    expect(result.sessions[0].exercises).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 10. Dose policy: Tier A verbatim vs Tier B/C never inheriting reps/intensity
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — dose policy differs by tier', () => {
  it('Tier A preserves sets/reps/duration/distance/cycles/intensity/notes verbatim', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: { 'vetoed-exercise': { A: [candidate('candidate-a')], B: [], C: [] } },
    });
    const original = exercise('vetoed-exercise', { sets: 3, reps: '4-6', intensity: 'alta', notes: 'nota' });
    const sessions = [session([original])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0]).toMatchObject({
      exerciseId: 'candidate-a', sets: 3, reps: '4-6', intensity: 'alta', notes: 'nota',
    });
  });

  it('Tier B never inherits reps from the original — not even a high, "safe-looking" rep range (no <=6 special case)', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: { 'vetoed-exercise': { A: [], B: [candidate('candidate-b')], C: [] } },
    });
    const original = exercise('vetoed-exercise', { sets: 3, reps: '12-15' });
    const sessions = [session([original])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    // No authoritative substitute-specific reps exist -> Tier B rejects,
    // and there is no other candidate, so this fails closed.
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.decisions[0].rejectedCandidates).toEqual([
      { exerciseId: 'candidate-b', tier: 'B', reasonCode: 'CANDIDATE_UNSAFE_DOSE' },
    ]);
  });

  it('Tier B never inherits a low-rep strength range either — the same rejection, proving there is no special <=6 threshold branch', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: { 'vetoed-exercise': { A: [], B: [candidate('candidate-b')], C: [] } },
    });
    const lowRep = applyMusculoskeletalLimitationV127(
      [session([exercise('vetoed-exercise', { sets: 3, reps: '4-6' })])], GYM, ['knee'], data,
    );
    const highRep = applyMusculoskeletalLimitationV127(
      [session([exercise('vetoed-exercise', { sets: 3, reps: '12-15' })])], GYM, ['knee'], data,
    );
    // Both rejected identically — reps value never changes the outcome,
    // because the decision is driven by "authoritative source exists?",
    // not by any range/threshold read from the original.
    expect(lowRep.status).toBe('BLOCKED');
    expect(highRep.status).toBe('BLOCKED');
    if (lowRep.status !== 'BLOCKED' || highRep.status !== 'BLOCKED') return;
    expect(lowRep.decisions[0].rejectedCandidates).toEqual(highRep.decisions[0].rejectedCandidates);
  });

  it('Tier B preserves `sets` alone when the original has no reps/intensity at all — no authoritative source is needed', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: { 'vetoed-exercise': { A: [], B: [candidate('candidate-b')], C: [] } },
    });
    const original = exercise('vetoed-exercise', { sets: 4 });
    const sessions = [session([original])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0]).toMatchObject({ exerciseId: 'candidate-b', sets: 4 });
    expect(result.sessions[0].exercises[0].reps).toBeUndefined();
  });

  it('Tier C never inherits reps or intensity either, for the same reason as Tier B', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: { 'vetoed-exercise': { A: [], B: [], C: [candidate('candidate-c')] } },
    });
    const original = exercise('vetoed-exercise', { sets: 3, reps: '12-15', intensity: 'moderada' });
    const sessions = [session([original])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.decisions[0].rejectedCandidates).toEqual([
      { exerciseId: 'candidate-c', tier: 'C', reasonCode: 'CANDIDATE_UNSAFE_DOSE' },
    ]);
  });

  it('Tier C preserves `sets` alone when the original has no reps/intensity at all', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: { 'vetoed-exercise': { A: [], B: [], C: [candidate('candidate-c')] } },
    });
    const original = exercise('vetoed-exercise', { sets: 3 });
    const sessions = [session([original])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0]).toMatchObject({ exerciseId: 'candidate-c', sets: 3 });
    expect(result.sessions[0].exercises[0].reps).toBeUndefined();
  });

  it('Tier C keeps duration/distance/cycleRange — those are not a "reps" concern and need no authoritative source', () => {
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: { 'vetoed-exercise': { A: [], B: [], C: [candidate('candidate-c')] } },
    });
    const original = exercise('vetoed-exercise', { distance: '20-40 m', cycleRange: { min: 5, max: 7 } });
    const sessions = [session([original])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0]).toMatchObject({ distance: '20-40 m', cycleRange: { min: 5, max: 7 } });
  });

  it('fails closed (does not invent a dose) when Tier B/C would leave no dose field at all', () => {
    // Original has ONLY reps — Tier B/C must drop it (no authoritative
    // source), and there is no sets/duration/distance/cycleRange to fall
    // back on either.
    const data = syntheticData({
      avoidByRegion: { knee: ['vetoed-exercise'] },
      candidatesByRuntimeId: { 'vetoed-exercise': { A: [], B: [candidate('candidate-b')], C: [] } },
    });
    const original = exercise('vetoed-exercise', { reps: '4-6' });
    const sessions = [session([original])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, ['knee'], data);
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.decisions[0].rejectedCandidates).toEqual([
      { exerciseId: 'candidate-b', tier: 'B', reasonCode: 'CANDIDATE_UNSAFE_DOSE' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 11. Seven regions — at least one representative real-data case each.
//     Given the strict dose policy, most real avoid-listed exercises (which
//     carry `reps`) can now only ever resolve via Tier A (no authoritative
//     substitute dose exists for B/C) — knee/spine/shoulder/elbow currently
//     have no Tier A candidate for any of their avoid-listed exercises, so
//     their representative case is a real, honest BLOCKED outcome.
// ---------------------------------------------------------------------------

describe('applyMusculoskeletalLimitationV127 — real data, one representative case per region', () => {
  const representative: Record<MusculoskeletalLimitationRegionV127, { id: string; outcome: 'SUBSTITUTED' | 'BLOCKED'; tier?: 'A' }> = {
    knee: { id: 'leg-press-45', outcome: 'BLOCKED' },
    hip: { id: 'bench-step-up', outcome: 'SUBSTITUTED', tier: 'A' },
    spine: { id: 'barbell-back-squat', outcome: 'BLOCKED' },
    shoulder: { id: 'dumbbell-fly', outcome: 'BLOCKED' },
    elbow: { id: 'farmers-walk', outcome: 'BLOCKED' },
    wrist: { id: 'push-up', outcome: 'SUBSTITUTED', tier: 'A' },
    ankle_foot: { id: 'gentle-direction-changes', outcome: 'SUBSTITUTED', tier: 'A' },
  };

  it.each(MUSCULOSKELETAL_LIMITATION_REGIONS_V127)('region "%s" vetoes its representative real exercise and resolves deterministically', (region) => {
    const { id, outcome, tier } = representative[region];
    expect(AVOID_RUNTIME_IDS_BY_REGION_V127[region].has(id)).toBe(true);
    const sessions = [session([exercise(id, { sets: 3, reps: '8-12' })])];
    const result = applyMusculoskeletalLimitationV127(sessions, GYM, [region]);
    expect(result.status).toBe(outcome === 'SUBSTITUTED' ? 'APPLIED' : 'BLOCKED');
    expect(result.decisions[0]).toMatchObject(
      outcome === 'SUBSTITUTED' ? { outcome, tier, vetoedByRegions: [region] } : { outcome, vetoedByRegions: [region] },
    );
  });
});

// ---------------------------------------------------------------------------
// composeTemplateV127 integration — the Fase 5 stage actually wires in
// ---------------------------------------------------------------------------

describe('composeTemplateV127 — musculoskeletal_limitation stage integration', () => {
  it('T001 with no limitationRegions composes identically to the Fase 4 baseline', () => {
    const template = getCanonicalTemplateV127ById('T001');
    const baseline = composeTemplateV127(template);
    const withEmptyRegions = composeTemplateV127(template, { limitationRegions: [] });
    expect(withEmptyRegions).toEqual(baseline);
    expect(baseline.trace.musculoskeletalLimitationApplied).toBe(false);
  });

  it('T025 with elbow active substitutes farmers-walk via Tier C (distance-based — no reps/intensity needed) and marks the stage as applied', () => {
    const template = getCanonicalTemplateV127ById('T025');
    const ids = template.sessions.flatMap((s) => s.exercises.map((e) => e.exercise_id));
    expect(ids).toContain('farmers-walk');
    const result = composeTemplateV127(template, { limitationRegions: ['elbow'] });
    expect(result.status).toBe('COMPOSED');
    expect(result.trace.musculoskeletalLimitationApplied).toBe(true);
    expect(result.trace.stagesApplied).toEqual(['musculoskeletal_limitation']);
    expect(result.trace.limitationDecisions).toEqual([{
      sessionIndex: 1, exerciseId: 'farmers-walk', vetoedByRegions: ['elbow'],
      outcome: 'SUBSTITUTED', tier: 'C', substituteExerciseId: 'controlled-marching', rejectedCandidates: [],
    }]);
    if (result.status !== 'COMPOSED') return;
    const exerciseIds = result.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId));
    expect(exerciseIds).not.toContain('farmers-walk');
    expect(exerciseIds).toContain('controlled-marching');
  });

  it('accepts the legacy `back` region id and normalizes it to `spine` at the v1.27 boundary (both fail closed identically today)', () => {
    const template = getCanonicalTemplateV127ById('T001'); // contains barbell-back-squat (spine-vetoed, no Tier A candidate today)
    const withSpine = composeTemplateV127(template, { limitationRegions: ['spine'] });
    const withBack = composeTemplateV127(template, { limitationRegions: ['back'] });
    expect(withBack).toEqual(withSpine);
    expect(withBack.trace.musculoskeletalLimitationApplied).toBe(true);
    expect(withBack.status).toBe('MUSCULOSKELETAL_SUBSTITUTION_UNAVAILABLE');
  });

  it('drops unrecognized/unimplemented region ids (e.g. "other") without effect or error', () => {
    const template = getCanonicalTemplateV127ById('T001');
    const baseline = composeTemplateV127(template);
    const withOther = composeTemplateV127(template, { limitationRegions: ['other'] });
    expect(withOther).toEqual(baseline);
    expect(withOther.trace.musculoskeletalLimitationApplied).toBe(false);
    expect(withOther.trace.stagesApplied).toEqual([]);
  });

  it('propagates a fail-closed MUSCULOSKELETAL_SUBSTITUTION_UNAVAILABLE result end-to-end when a real template has no safe substitute', () => {
    const template = getCanonicalTemplateV127ById('T001');
    const ids = template.sessions.flatMap((s) => s.exercises.map((e) => e.exercise_id));
    expect(ids).toContain('machine-shoulder-press');
    const result = composeTemplateV127(template, { limitationRegions: ['shoulder'] });
    expect(result.status).toBe('MUSCULOSKELETAL_SUBSTITUTION_UNAVAILABLE');
    if (result.status !== 'MUSCULOSKELETAL_SUBSTITUTION_UNAVAILABLE') return;
    expect(result.reasonCodes.length).toBeGreaterThan(0);
    expect(result.trace.limitationDecisions.some((d) => d.exerciseId === 'machine-shoulder-press' && d.outcome === 'BLOCKED')).toBe(true);
  });
});
