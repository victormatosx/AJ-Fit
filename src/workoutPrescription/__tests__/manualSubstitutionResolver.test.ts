import { describe,expect,it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { equipmentContextFor } from '../equipment';
import type { CatalogExercise } from '../exerciseCatalog';
import {
  evaluateManualSubstitutionCandidate,
  evaluateRevertToAnchor,
  rankManualSubstitutionCandidates,
  resolveManualSubstitutionCandidates,
  resolvePermanentSubstitutionsForSession,
} from '../manualSubstitutionResolver';
import { completeAnswers } from './fixtures';

const catalog = new Map<string, CatalogExercise>(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));
const gymEquipmentContext = equipmentContextFor(completeAnswers({ place: 'gym' }), 'gym');

function get(id: string): CatalogExercise {
  const exercise = catalog.get(id);
  if (!exercise) throw new Error(`fixture exercise missing: ${id}`);
  return exercise;
}

function noneEmptySet(): Set<string> {
  return new Set<string>();
}

describe('resolveManualSubstitutionCandidates: candidate universe is the full substitution.group, not the pre-cut similarExerciseIds', () => {
  it('surfaces bodyweight-squat/goblet-squat/chair-squat for barbell-back-squat even though buildSubstitutions() cut them from similarExerciseIds', () => {
    const source = get('barbell-back-squat');
    // Confirms the audit's finding: these three are NOT in the pre-cut list.
    expect(source.substitution.similarExerciseIds).not.toContain('bodyweight-squat');
    expect(source.substitution.similarExerciseIds).not.toContain('goblet-squat');
    expect(source.substitution.similarExerciseIds).not.toContain('chair-squat');

    const homeAnswers = completeAnswers({ place: 'home', equipment: ['bodyweight', 'dumbbells', 'bench_or_box'] });
    const homeContext = equipmentContextFor(homeAnswers, 'home');
    const result = resolveManualSubstitutionCandidates({
      anchorExerciseId: 'barbell-back-squat',
      catalog,
      equipmentContext: homeContext,
      effectiveExerciseIdsInSession: noneEmptySet(),
      maxResults: 10,
      });
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    const ids = result.candidates.map((c) => c.exerciseId);
    expect(ids).toContain('bodyweight-squat');
    expect(ids).toContain('goblet-squat');
    expect(ids).toContain('chair-squat');
  });
});

describe('resolveManualSubstitutionCandidates: purpose preservation', () => {
  it('never includes a candidate with a different movement pattern', () => {
    const result = resolveManualSubstitutionCandidates({
      anchorExerciseId: 'barbell-back-squat',
      catalog,
      equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: noneEmptySet(),
      maxResults: 100,
      });
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    for (const candidate of result.candidates) {
      expect(catalog.get(candidate.exerciseId)!.movement.pattern).toBe('squat');
    }
  });
});

describe('evaluateManualSubstitutionCandidate: equipment/environment', () => {
  it('rejects an equipment-incompatible candidate in a dumbbell-only home context', () => {
    const homeAnswers = completeAnswers({ place: 'home', equipment: ['dumbbells'] });
    const homeContext = equipmentContextFor(homeAnswers, 'home');
    const source = get('barbell-back-squat');
    const evaluation = evaluateManualSubstitutionCandidate({
      source, candidateId: 'hack-squat-machine-variation', catalog, equipmentContext: homeContext,
      effectiveExerciseIdsInSession: noneEmptySet(), });
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reasonCodes).toContain('EQUIPMENT_UNAVAILABLE');
  });
});

describe('evaluateManualSubstitutionCandidate: availability gate', () => {
  it('rejects a candidate whose availability.manualSelection is false', () => {
    const source = get('barbell-back-squat');
    const disabled = { ...get('hack-squat-machine-variation'), availability: { workoutGeneration: true, manualSelection: false, substitution: true } };
    const localCatalog = new Map(catalog);
    localCatalog.set(disabled.id, disabled);
    const evaluation = evaluateManualSubstitutionCandidate({
      source, candidateId: disabled.id, catalog: localCatalog, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: noneEmptySet(), });
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reasonCodes).toContain('CANDIDATE_NOT_AVAILABLE_FOR_MANUAL_SUBSTITUTION');
  });

  it('rejects a candidate whose availability.substitution is false', () => {
    const source = get('barbell-back-squat');
    const disabled = { ...get('hack-squat-machine-variation'), availability: { workoutGeneration: true, manualSelection: true, substitution: false } };
    const localCatalog = new Map(catalog);
    localCatalog.set(disabled.id, disabled);
    const evaluation = evaluateManualSubstitutionCandidate({
      source, candidateId: disabled.id, catalog: localCatalog, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: noneEmptySet(), });
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reasonCodes).toContain('CANDIDATE_NOT_AVAILABLE_FOR_MANUAL_SUBSTITUTION');
  });
});

describe('evaluateManualSubstitutionCandidate: exclusion of the anchor itself and of exercises already effective in the session', () => {
  it('the resolved candidate pool never includes the anchor exercise itself', () => {
    const result = resolveManualSubstitutionCandidates({
      anchorExerciseId: 'barbell-back-squat',
      catalog, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: noneEmptySet(),
      maxResults: 100,
      });
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.candidates.map((c) => c.exerciseId)).not.toContain('barbell-back-squat');
  });

  it('rejects a candidate already effectively present in another slot of the session (Caso 2/3 of the audit: B->X then trying to substitute A)', () => {
    const source = get('barbell-back-squat');
    const evaluation = evaluateManualSubstitutionCandidate({
      source, candidateId: 'hack-squat-machine-variation', catalog, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: new Set(['hack-squat-machine-variation']), });
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reasonCodes).toContain('DUPLICATE_IN_SESSION');
  });

  it('end-to-end: resolveManualSubstitutionCandidates never returns a candidate present in effectiveExerciseIdsInSession', () => {
    const result = resolveManualSubstitutionCandidates({
      anchorExerciseId: 'barbell-back-squat',
      catalog, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: new Set(['hack-squat-machine-variation', 'goblet-squat']),
      maxResults: 100,
      });
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    const ids = result.candidates.map((c) => c.exerciseId);
    expect(ids).not.toContain('hack-squat-machine-variation');
    expect(ids).not.toContain('goblet-squat');
  });
});

describe('rankManualSubstitutionCandidates: deterministic ordering', () => {
  it('never depends on input array order', () => {
    const evaluations = [
      { exerciseId: 'c', eligible: true, reasonCodes: [], declaredSimilar: false, difficultyDistance: 1, lateralityMatch: false },
      { exerciseId: 'a', eligible: true, reasonCodes: [], declaredSimilar: false, difficultyDistance: 1, lateralityMatch: false },
      { exerciseId: 'b', eligible: true, reasonCodes: [], declaredSimilar: false, difficultyDistance: 1, lateralityMatch: false },
    ];
    const forward = rankManualSubstitutionCandidates(evaluations).map((c) => c.exerciseId);
    const reversed = rankManualSubstitutionCandidates([...evaluations].reverse()).map((c) => c.exerciseId);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual(['a', 'b', 'c']);
  });

  it('excludes ineligible candidates entirely', () => {
    const ranked = rankManualSubstitutionCandidates([
      { exerciseId: 'a', eligible: false, reasonCodes: ['ROLE_MISMATCH'], declaredSimilar: false, difficultyDistance: 0, lateralityMatch: false },
      { exerciseId: 'b', eligible: true, reasonCodes: [], declaredSimilar: false, difficultyDistance: 0, lateralityMatch: false },
    ]);
    expect(ranked.map((r) => r.exerciseId)).toEqual(['b']);
  });

  it('prefers a declared-similar candidate over a non-declared one', () => {
    const ranked = rankManualSubstitutionCandidates([
      { exerciseId: 'non-similar', eligible: true, reasonCodes: [], declaredSimilar: false, difficultyDistance: 0, lateralityMatch: false },
      { exerciseId: 'similar', eligible: true, reasonCodes: [], declaredSimilar: true, difficultyDistance: 0, lateralityMatch: false },
    ]);
    expect(ranked[0].exerciseId).toBe('similar');
  });
});

describe('resolveManualSubstitutionCandidates: top-3 is applied only after every filter, never padded', () => {
  it('returns exactly 3 when 10+ are eligible', () => {
    const result = resolveManualSubstitutionCandidates({
      anchorExerciseId: 'barbell-back-squat', catalog, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: noneEmptySet(), });
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.evaluated.filter((e) => e.eligible).length).toBeGreaterThan(3);
    expect(result.candidates).toHaveLength(3);
  });

  it('returns exactly 2 when only 2 are eligible (never pads to 3)', () => {
    // Restrict the catalog to the anchor plus exactly two eligible peers.
    const restricted = new Map(catalog);
    for (const [id, exercise] of catalog) {
      if (exercise.substitution.group === 'quad_squat' && !['barbell-back-squat', 'goblet-squat', 'chair-squat'].includes(id)) {
        restricted.delete(id);
      }
    }
    const result = resolveManualSubstitutionCandidates({
      anchorExerciseId: 'barbell-back-squat', catalog: restricted, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: noneEmptySet(), });
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.candidates).toHaveLength(2);
  });

  it('returns exactly 1 when only 1 is eligible', () => {
    const restricted = new Map(catalog);
    for (const [id, exercise] of catalog) {
      if (exercise.substitution.group === 'quad_squat' && !['barbell-back-squat', 'goblet-squat'].includes(id)) {
        restricted.delete(id);
      }
    }
    const result = resolveManualSubstitutionCandidates({
      anchorExerciseId: 'barbell-back-squat', catalog: restricted, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: noneEmptySet(), });
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.candidates).toHaveLength(1);
  });

  it('returns NO_ELIGIBLE_CANDIDATES (never an invented fallback) when zero candidates survive', () => {
    const restricted = new Map(catalog);
    for (const [id, exercise] of catalog) {
      if (exercise.substitution.group === 'quad_squat' && id !== 'barbell-back-squat') restricted.delete(id);
    }
    const result = resolveManualSubstitutionCandidates({
      anchorExerciseId: 'barbell-back-squat', catalog: restricted, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: noneEmptySet(), });
    expect(result.status).toBe('NO_ELIGIBLE_CANDIDATES');
  });

  it('returns INVALID_ANCHOR for an unknown exerciseId', () => {
    const result = resolveManualSubstitutionCandidates({
      anchorExerciseId: 'does-not-exist', catalog, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: noneEmptySet(), });
    expect(result.status).toBe('INVALID_ANCHOR');
  });
});

describe('evaluateRevertToAnchor', () => {
  it('is eligible when the anchor is still safe/executable and not duplicated elsewhere', () => {
    const result = evaluateRevertToAnchor({
      anchorExerciseId: 'barbell-back-squat', catalog, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: noneEmptySet(), });
    expect(result.eligible).toBe(true);
  });

  it('rejects reverting when the anchor is no longer equipment-executable', () => {
    const homeAnswers = completeAnswers({ place: 'home', equipment: ['bodyweight'] });
    const homeContext = equipmentContextFor(homeAnswers, 'home');
    const result = evaluateRevertToAnchor({
      anchorExerciseId: 'barbell-back-squat', catalog, equipmentContext: homeContext,
      effectiveExerciseIdsInSession: noneEmptySet(), });
    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain('EQUIPMENT_UNAVAILABLE');
  });

  it('rejects reverting when the anchor is already effectively present in another slot', () => {
    const result = evaluateRevertToAnchor({
      anchorExerciseId: 'barbell-back-squat', catalog, equipmentContext: gymEquipmentContext,
      effectiveExerciseIdsInSession: new Set(['barbell-back-squat']), });
    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain('DUPLICATE_IN_SESSION');
  });
});

describe('resolvePermanentSubstitutionsForSession ("Todos os próximos treinos" materialization)', () => {
  it('applies a valid A -> B preference', () => {
    const resolved = resolvePermanentSubstitutionsForSession({
      sessionExerciseIds: ['barbell-back-squat', 'bench_press_placeholder_not_in_group'],
      preferences: new Map([['barbell-back-squat', 'goblet-squat']]),
      catalog, equipmentContext: gymEquipmentContext, });
    expect(resolved.get(0)).toBe('goblet-squat');
  });

  it('leaves a slot untouched when it has no stored preference', () => {
    const resolved = resolvePermanentSubstitutionsForSession({
      sessionExerciseIds: ['barbell-back-squat'],
      preferences: new Map(),
      catalog, equipmentContext: gymEquipmentContext, });
    expect(resolved.size).toBe(0);
  });

  it('A -> X and B -> X in the same session: only the first slot receives X, deterministically by slot order', () => {
    const resolved = resolvePermanentSubstitutionsForSession({
      sessionExerciseIds: ['barbell-back-squat', 'hack-squat-machine-variation'],
      preferences: new Map([
        ['barbell-back-squat', 'goblet-squat'],
        ['hack-squat-machine-variation', 'goblet-squat'],
      ]),
      catalog, equipmentContext: gymEquipmentContext, });
    expect(resolved.get(0)).toBe('goblet-squat');
    expect(resolved.has(1)).toBe(false); // falls back to its own prescribed exercise
  });

  it('the collision result is deterministic across repeated calls with the same input', () => {
    const input = {
      sessionExerciseIds: ['barbell-back-squat', 'hack-squat-machine-variation'] as readonly string[],
      preferences: new Map([
        ['barbell-back-squat', 'goblet-squat'],
        ['hack-squat-machine-variation', 'goblet-squat'],
      ]),
      catalog, equipmentContext: gymEquipmentContext,
    };
    const first = resolvePermanentSubstitutionsForSession(input);
    const second = resolvePermanentSubstitutionsForSession(input);
    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it('reversing slot order flips which slot wins the collision — proves the rule is slot-order-based, not id-based', () => {
    const resolved = resolvePermanentSubstitutionsForSession({
      sessionExerciseIds: ['hack-squat-machine-variation', 'barbell-back-squat'],
      preferences: new Map([
        ['barbell-back-squat', 'goblet-squat'],
        ['hack-squat-machine-variation', 'goblet-squat'],
      ]),
      catalog, equipmentContext: gymEquipmentContext, });
    expect(resolved.get(0)).toBe('goblet-squat'); // now hack-squat-machine-variation's slot, since it's first
    expect(resolved.has(1)).toBe(false);
  });

  it('an equipment-invalid preference falls back to the prescribed exercise (never a third alternative)', () => {
    const homeAnswers = completeAnswers({ place: 'home', equipment: ['bodyweight'] });
    const homeContext = equipmentContextFor(homeAnswers, 'home');
    const resolved = resolvePermanentSubstitutionsForSession({
      sessionExerciseIds: ['barbell-back-squat'],
      preferences: new Map([['barbell-back-squat', 'hack-squat-machine-variation']]), // needs hack_machine, unavailable at home
      catalog, equipmentContext: homeContext, });
    expect(resolved.size).toBe(0);
  });

  it('an availability-invalid preference falls back to the prescribed exercise', () => {
    const disabled: CatalogExercise = {
      ...get('goblet-squat'),
      availability: { workoutGeneration: true, manualSelection: true, substitution: false },
    };
    const localCatalog = new Map(catalog);
    localCatalog.set(disabled.id, disabled);
    const resolved = resolvePermanentSubstitutionsForSession({
      sessionExerciseIds: ['barbell-back-squat'],
      preferences: new Map([['barbell-back-squat', 'goblet-squat']]),
      catalog: localCatalog, equipmentContext: gymEquipmentContext, });
    expect(resolved.size).toBe(0);
  });

  it('never mutates the sessionExerciseIds input array (the FinalWorkoutPlan itself is never touched)', () => {
    const sessionExerciseIds = ['barbell-back-squat'];
    const frozen = Object.freeze([...sessionExerciseIds]);
    expect(() => resolvePermanentSubstitutionsForSession({
      sessionExerciseIds: frozen,
      preferences: new Map([['barbell-back-squat', 'goblet-squat']]),
      catalog, equipmentContext: gymEquipmentContext, })).not.toThrow();
    expect(frozen).toEqual(['barbell-back-squat']);
  });

  it('a preference identical to the anchor itself (no-op) resolves nothing', () => {
    const resolved = resolvePermanentSubstitutionsForSession({
      sessionExerciseIds: ['barbell-back-squat'],
      preferences: new Map([['barbell-back-squat', 'barbell-back-squat']]),
      catalog, equipmentContext: gymEquipmentContext, });
    expect(resolved.size).toBe(0);
  });
});
