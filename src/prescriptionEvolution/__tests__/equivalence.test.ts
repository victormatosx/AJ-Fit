import { describe, expect, it } from 'vitest';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { equipmentContextFor } from '../../workoutPrescription/equipment';
import type { LimitationCatalogExercise } from '../../workoutPrescription/limitationResolver';
import { completeAnswers, realLimitationCatalogFixture } from '../../workoutPrescription/__tests__/fixtures';
import {
  candidatePoolFor,
  evaluateEquivalenceCandidate,
  isLimitationSafe,
  purposePreserved,
  rankCandidates,
} from '../equivalence';

const catalog = new Map<string, LimitationCatalogExercise>(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));
const limitationCatalog = new Map<string, LimitationCatalogExercise>(
  realLimitationCatalogFixture().map((exercise) => [exercise.id, exercise]),
);

function get(id: string): LimitationCatalogExercise {
  const exercise = catalog.get(id);
  if (!exercise) throw new Error(`fixture exercise missing: ${id}`);
  return exercise;
}

describe('purposePreserved (same-muscle-only is never equivalence)', () => {
  it('rejects a candidate with a different movement pattern even if the primary muscle matches', () => {
    // Find two real exercises with the same primary muscle but different movement patterns.
    const source = [...catalog.values()].find((exercise) => exercise.movement.pattern === 'horizontal_push');
    const differentPattern = [...catalog.values()].find(
      (exercise) => source
        && exercise.target.primaryMuscle === source.target.primaryMuscle
        && exercise.movement.pattern !== source.movement.pattern,
    );
    expect(source).toBeDefined();
    expect(differentPattern).toBeDefined();
    if (!source || !differentPattern) return;
    expect(purposePreserved(source, differentPattern)).toBe(false);
  });

  it('accepts a candidate sharing both movement pattern and primary muscle', () => {
    const source = [...catalog.values()][0];
    const clone = { ...source, id: 'clone-of-source' };
    expect(purposePreserved(source, clone)).toBe(true);
  });
});

describe('isLimitationSafe', () => {
  it('is always safe when the user has no declared limitation regions', () => {
    const anyExercise = get([...catalog.keys()][0]);
    expect(isLimitationSafe(anyExercise, [])).toBe(true);
  });

  it('rejects a candidate with no approved limitationProfile once the user has declared a region', () => {
    const withoutProfile = get([...catalog.keys()][0]);
    expect(isLimitationSafe(withoutProfile, ['knee'])).toBe(false);
  });

  it('accepts a real exercise whose approved profile marks the declared region compatible', () => {
    const compatible = [...limitationCatalog.values()].find((exercise) => {
      const profile = exercise.limitationProfile as { regions?: Record<string, { status?: string }> } | undefined;
      return profile?.regions?.knee?.status === 'compatible';
    });
    expect(compatible).toBeDefined();
    if (!compatible) return;
    expect(isLimitationSafe(compatible, ['knee'])).toBe(true);
  });
});

describe('candidatePoolFor', () => {
  it('never includes the source exercise itself', () => {
    const source = get([...catalog.keys()][0]);
    const pool = candidatePoolFor(source, catalog);
    expect(pool).not.toContain(source.id);
  });

  it('draws from declared similarExerciseIds and same-group/pattern/mechanic peers', () => {
    const source = [...catalog.values()].find((exercise) => exercise.substitution.similarExerciseIds.length > 0);
    expect(source).toBeDefined();
    if (!source) return;
    const pool = candidatePoolFor(source, catalog);
    for (const id of source.substitution.similarExerciseIds) expect(pool).toContain(id);
  });
});

describe('evaluateEquivalenceCandidate', () => {
  const answers = completeAnswers({ place: 'gym' });
  const equipmentContext = equipmentContextFor(answers, 'gym');

  it('rejects a candidate already used elsewhere in the plan', () => {
    const source = get([...catalog.keys()][0]);
    const pool = candidatePoolFor(source, catalog);
    if (pool.length === 0) return;
    const evaluation = evaluateEquivalenceCandidate({
      source, candidateId: pool[0], catalog, regions: [], equipmentContext,
      usedExerciseIds: new Set([pool[0]]), recentExerciseIds: new Set(),
    });
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reasonCodes).toContain('DUPLICATE_IN_PLAN');
  });

  it('rejects an equipment-incompatible candidate in a dumbbell-only home context', () => {
    const homeAnswers = completeAnswers({ place: 'home', equipment: ['dumbbells'] });
    const homeContext = equipmentContextFor(homeAnswers, 'home');
    const barbellExercise = [...catalog.values()].find((exercise) => exercise.equipment.includes('barbell') && !exercise.equipment.includes('dumbbell'));
    expect(barbellExercise).toBeDefined();
    if (!barbellExercise) return;
    const evaluation = evaluateEquivalenceCandidate({
      source: barbellExercise, candidateId: barbellExercise.id, catalog, regions: [], equipmentContext: homeContext,
      usedExerciseIds: new Set(), recentExerciseIds: new Set(),
    });
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reasonCodes).toContain('EQUIPMENT_UNAVAILABLE');
  });

  it('marks a declared similarExerciseIds candidate as declaredSimilar', () => {
    const source = [...catalog.values()].find((exercise) => exercise.substitution.similarExerciseIds.length > 0);
    expect(source).toBeDefined();
    if (!source) return;
    const candidateId = source.substitution.similarExerciseIds[0];
    const evaluation = evaluateEquivalenceCandidate({
      source, candidateId, catalog, regions: [], equipmentContext,
      usedExerciseIds: new Set(), recentExerciseIds: new Set(),
    });
    expect(evaluation.declaredSimilar).toBe(true);
  });

  it('rejects the real hip-thrust -> cable-glute-kickback compound-to-isolation regression even when declared similar', () => {
    const source = get('hip-thrust');
    const candidate = get('cable-glute-kickback');
    expect(source.movement.mechanic).toBe('compound');
    expect(candidate.movement.mechanic).toBe('isolation');
    expect(source.substitution.similarExerciseIds).toContain(candidate.id);

    const evaluation = evaluateEquivalenceCandidate({
      source,
      candidateId: candidate.id,
      catalog,
      regions: [],
      equipmentContext,
      usedExerciseIds: new Set(),
      recentExerciseIds: new Set(),
    });

    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reasonCodes).toContain('ROLE_MISMATCH');
  });

  it('accepts a real compound-to-compound alternative in the same slot role', () => {
    const source = get('machine-shoulder-press');
    const candidate = get('dumbbell-shoulder-press');
    const evaluation = evaluateEquivalenceCandidate({
      source,
      candidateId: candidate.id,
      catalog,
      regions: [],
      equipmentContext,
      usedExerciseIds: new Set(),
      recentExerciseIds: new Set(),
      slotContext: {
        sessionName: 'Upper A',
        sessionType: 'strength',
        exerciseIndex: 1,
        isMovementAnchor: false,
        sourceMovementPattern: source.movement.pattern,
        sourceMechanic: source.movement.mechanic,
      },
    });
    expect(source.movement.mechanic).toBe('compound');
    expect(candidate.movement.mechanic).toBe('compound');
    expect(evaluation).toMatchObject({ eligible: true, reasonCodes: [] });
  });

  it('the real dataset exposes valid positive coverage for both compound and isolation roles, and every accepted declared edge preserves role', () => {
    const accepted = [...catalog.values()].flatMap((source) =>
      source.substitution.similarExerciseIds.map((candidateId) => ({
        source,
        candidate: catalog.get(candidateId),
        evaluation: evaluateEquivalenceCandidate({
          source, candidateId, catalog, regions: [], equipmentContext,
          usedExerciseIds: new Set(), recentExerciseIds: new Set(),
        }),
      }))).filter((item) => item.candidate && item.evaluation.eligible);

    expect(accepted.length).toBeGreaterThan(20);
    expect(accepted.some((item) => item.source.movement.mechanic === 'compound')).toBe(true);
    expect(accepted.some((item) => item.source.movement.mechanic === 'isolation')).toBe(true);
    for (const { source, candidate } of accepted) {
      expect(candidate!.movement.pattern).toBe(source.movement.pattern);
      expect(candidate!.movement.mechanic).toBe(source.movement.mechanic);
    }
  });
});

describe('rankCandidates', () => {
  it('excludes ineligible candidates entirely', () => {
    const ranked = rankCandidates([
      { exerciseId: 'a', eligible: false, reasonCodes: ['X'], declaredSimilar: false, recentlyUsed: false, difficultyDistance: 0 },
      { exerciseId: 'b', eligible: true, reasonCodes: [], declaredSimilar: false, recentlyUsed: false, difficultyDistance: 0 },
    ], 'salt');
    expect(ranked.map((r) => r.exerciseId)).toEqual(['b']);
  });

  it('prefers a declared-similar candidate over a non-declared one', () => {
    const ranked = rankCandidates([
      { exerciseId: 'non-similar', eligible: true, reasonCodes: [], declaredSimilar: false, recentlyUsed: false, difficultyDistance: 0 },
      { exerciseId: 'similar', eligible: true, reasonCodes: [], declaredSimilar: true, recentlyUsed: false, difficultyDistance: 0 },
    ], 'salt');
    expect(ranked[0].exerciseId).toBe('similar');
  });

  it('penalizes (but does not exclude) a recently used candidate', () => {
    const ranked = rankCandidates([
      { exerciseId: 'recent', eligible: true, reasonCodes: [], declaredSimilar: true, recentlyUsed: true, difficultyDistance: 0 },
      { exerciseId: 'fresh', eligible: true, reasonCodes: [], declaredSimilar: true, recentlyUsed: false, difficultyDistance: 0 },
    ], 'salt');
    expect(ranked[0].exerciseId).toBe('fresh');
    expect(ranked.map((r) => r.exerciseId)).toContain('recent');
  });

  it('falls back to the recently-used candidate when it is the only eligible one', () => {
    const ranked = rankCandidates([
      { exerciseId: 'only-option', eligible: true, reasonCodes: [], declaredSimilar: false, recentlyUsed: true, difficultyDistance: 2 },
    ], 'salt');
    expect(ranked[0].exerciseId).toBe('only-option');
  });

  it('is deterministic: same evaluations + same salt -> same order every time', () => {
    const evaluations = [
      { exerciseId: 'x', eligible: true, reasonCodes: [], declaredSimilar: false, recentlyUsed: false, difficultyDistance: 1 },
      { exerciseId: 'y', eligible: true, reasonCodes: [], declaredSimilar: false, recentlyUsed: false, difficultyDistance: 1 },
      { exerciseId: 'z', eligible: true, reasonCodes: [], declaredSimilar: false, recentlyUsed: false, difficultyDistance: 1 },
    ];
    const first = rankCandidates(evaluations, 'cycle-3');
    const second = rankCandidates(evaluations, 'cycle-3');
    expect(first.map((r) => r.exerciseId)).toEqual(second.map((r) => r.exerciseId));
  });

  it('a different salt can produce a different tie-break order among equally-ranked candidates', () => {
    const evaluations = [
      { exerciseId: 'x', eligible: true, reasonCodes: [], declaredSimilar: false, recentlyUsed: false, difficultyDistance: 1 },
      { exerciseId: 'y', eligible: true, reasonCodes: [], declaredSimilar: false, recentlyUsed: false, difficultyDistance: 1 },
      { exerciseId: 'z', eligible: true, reasonCodes: [], declaredSimilar: false, recentlyUsed: false, difficultyDistance: 1 },
    ];
    const orders = new Set(
      ['cycle-1', 'cycle-2', 'cycle-3', 'cycle-4', 'cycle-5'].map(
        (salt) => rankCandidates(evaluations, salt).map((r) => r.exerciseId).join(','),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });
});
