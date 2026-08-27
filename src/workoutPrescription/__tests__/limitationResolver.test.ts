import { describe, expect, it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import {
  LIMITATION_REGION_IDS,
  type ExerciseLimitationProfile,
  type ExerciseLimitationRule,
  type LimitationRegionId,
} from '../../types/exercise';
import {
  mapQuestionnaireLimitations,
  resolveExerciseLimitations,
  resolveExerciseLimitationsFromCandidates,
  validateLimitationProfile,
  type LimitationCatalogExercise,
} from '../limitationResolver';
import { completeAnswers, realLimitationCatalogFixture } from './fixtures';

const base = EXERCISES_SEED.find((exercise) => exercise.id === 'machine-flat-bench-press')!;

function profile(
  overrides: Partial<Record<LimitationRegionId, ExerciseLimitationRule>> = {},
): ExerciseLimitationProfile {
  return {
    schemaVersion: 1,
    protocolVersion: 'musculoskeletal-v1',
    reviewStatus: 'approved',
    reviewBasis: 'product_policy',
    regions: Object.fromEntries(LIMITATION_REGION_IDS.map((region) => [
      region,
      overrides[region] ?? { status: 'compatible' },
    ])) as Record<LimitationRegionId, ExerciseLimitationRule>,
  };
}

function exercise(
  id: string,
  limitationProfile: unknown = profile(),
  equipment: LimitationCatalogExercise['equipment'] = ['bodyweight'],
): LimitationCatalogExercise {
  return {
    ...base,
    id,
    slug: id,
    name: { ...base.name, en: id },
    equipment,
    limitationProfile,
    substitution: { ...base.substitution, similarExerciseIds: [] },
  } as LimitationCatalogExercise;
}

function resolve(input: {
  source: LimitationCatalogExercise;
  candidates?: LimitationCatalogExercise[];
  regions?: LimitationRegionId[];
  executableIds?: string[];
}) {
  const items = [input.source, ...(input.candidates ?? [])];
  const catalog = new Map(items.map((item) => [item.id, item]));
  const executable = new Set(input.executableIds ?? items.map((item) => item.id));
  return resolveExerciseLimitations({
    exerciseId: input.source.id,
    regions: input.regions ?? ['knee'],
    catalog,
    isExecutable: (item) => executable.has(item.id),
  });
}

describe('Limitation Resolver V1', () => {
  it('uses the preferred clinical target when it is terminal and executable', () => {
    const source = exercise('a', profile({
      knee: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'b' } },
    }));
    const preferred = exercise('b');
    const fallback = exercise('c');
    source.substitution.limitationVariantIds = ['c'];
    const catalog = new Map([source, preferred, fallback].map((item) => [item.id, item]));

    const result = resolveExerciseLimitationsFromCandidates({
      exerciseId: source.id,
      regions: ['knee'],
      catalog,
      isExecutable: () => true,
    });
    expect(result).toEqual(expect.objectContaining({
      status: 'RESOLVED',
      exercise: expect.objectContaining({ id: 'b' }),
      candidateOrigin: 'preferred',
    }));
  });

  it('skips an unavailable preferred target and selects an executable declared fallback', () => {
    const source = exercise('a', profile({
      knee: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'b' } },
    }));
    const preferred = exercise('b');
    const fallback = exercise('c');
    source.substitution.limitationVariantIds = ['c'];
    const catalog = new Map([source, preferred, fallback].map((item) => [item.id, item]));

    const result = resolveExerciseLimitationsFromCandidates({
      exerciseId: source.id,
      regions: ['knee'],
      catalog,
      isExecutable: (item) => item.id !== 'b',
    });
    expect(result).toEqual(expect.objectContaining({
      status: 'RESOLVED',
      exercise: expect.objectContaining({ id: 'c' }),
      candidateOrigin: 'declared',
    }));
    if (result.status === 'RESOLVED') {
      expect(result.trace.candidatesEvaluated?.[0]).toEqual(expect.objectContaining({
        exerciseId: 'b', accepted: false,
        reasonCodes: expect.arrayContaining(['LIMITATION_CANDIDATE_EQUIPMENT_UNAVAILABLE']),
      }));
    }
  });

  it('computes the intersection of multiple limitations with no region precedence', () => {
    const source = exercise('a', profile({
      knee: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'b' } },
      back: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'c' } },
    }));
    const kneeOnly = exercise('b', profile({
      back: { status: 'avoid', substituteExerciseIds: [], candidateStatus: 'missing_exercise_candidate' },
    }));
    const backOnly = exercise('c', profile({
      knee: { status: 'avoid', substituteExerciseIds: [], candidateStatus: 'missing_exercise_candidate' },
    }));
    const intersection = exercise('d');
    source.substitution.limitationVariantIds = ['d'];
    const catalog = new Map([source, kneeOnly, backOnly, intersection]
      .map((item) => [item.id, item]));

    const result = resolveExerciseLimitationsFromCandidates({
      exerciseId: source.id,
      regions: ['knee', 'back'],
      catalog,
      isExecutable: () => true,
    });
    expect(result).toEqual(expect.objectContaining({
      status: 'RESOLVED',
      exercise: expect.objectContaining({ id: 'd' }),
    }));
    if (result.status === 'RESOLVED') {
      expect(result.trace.candidatesEvaluated).toEqual(expect.arrayContaining([
        expect.objectContaining({ exerciseId: 'b', accepted: false }),
        expect.objectContaining({ exerciseId: 'c', accepted: false }),
        expect.objectContaining({ exerciseId: 'd', accepted: true }),
      ]));
    }
  });
  it('accepts exactly the 76 persisted V2 profiles and leaves 40 unreviewed', () => {
    const catalogFixture = realLimitationCatalogFixture();
    const reviewed = catalogFixture.filter((item) => item.limitationProfile != null);
    expect(catalogFixture).toHaveLength(116);
    expect(reviewed).toHaveLength(76);
    expect(reviewed.every((item) => validateLimitationProfile(item.id, item.limitationProfile).valid)).toBe(true);
    expect(catalogFixture.filter((item) => item.limitationProfile == null)).toHaveLength(40);
  });

  it('keeps compatible and records the evaluated region', () => {
    const result = resolve({ source: exercise('a') });
    expect(result).toEqual(expect.objectContaining({
      status: 'RESOLVED',
      exercise: expect.objectContaining({ id: 'a' }),
      trace: expect.objectContaining({ resolution: 'compatible', regionsEvaluated: ['knee'] }),
    }));
  });

  it('treats not_applicable as no additional restriction', () => {
    const source = exercise('a', profile({ knee: { status: 'not_applicable' } }));
    expect(resolve({ source })).toEqual(expect.objectContaining({
      status: 'RESOLVED', trace: expect.objectContaining({ resolution: 'compatible' }),
    }));
  });

  it('uses the first limitation substitute valid for every constraint', () => {
    const source = exercise('a', profile({
      knee: { status: 'avoid', substituteExerciseIds: ['b'], candidateStatus: 'ready' },
    }));
    const result = resolve({ source, candidates: [exercise('b')] });
    expect(result).toEqual(expect.objectContaining({
      status: 'RESOLVED',
      exercise: expect.objectContaining({ id: 'b' }),
      trace: expect.objectContaining({ resolution: 'substituted', reasonRegions: ['knee'] }),
    }));
  });

  it('returns NO_SAFE_SUBSTITUTION for a valid empty avoid list', () => {
    const source = exercise('a', profile({
      knee: { status: 'avoid', substituteExerciseIds: [], candidateStatus: 'missing_exercise_candidate' },
    }));
    expect(resolve({ source })).toEqual({
      status: 'FAILED', reasonCodes: ['NO_SAFE_SUBSTITUTION'], candidatesEvaluated: [],
    });
  });

  it('skips the first candidate rejected by equipment and selects the second original candidate', () => {
    const source = exercise('a', profile({
      knee: { status: 'avoid', substituteExerciseIds: ['b', 'c'], candidateStatus: 'ready' },
    }));
    const result = resolve({
      source,
      candidates: [exercise('b', profile(), ['cable']), exercise('c')],
      executableIds: ['a', 'c'],
    });
    expect(result).toEqual(expect.objectContaining({
      status: 'RESOLVED',
      exercise: expect.objectContaining({ id: 'c' }),
      trace: expect.objectContaining({
        candidatesEvaluated: [
          expect.objectContaining({ exerciseId: 'b', accepted: false }),
          expect.objectContaining({ exerciseId: 'c', accepted: true }),
        ],
      }),
    }));
  });

  it('executes one concrete adaptation and revalidates its profile', () => {
    const source = exercise('a', profile({
      knee: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'b' } },
    }));
    expect(resolve({ source, candidates: [exercise('b')] })).toEqual(expect.objectContaining({
      status: 'RESOLVED',
      exercise: expect.objectContaining({ id: 'b' }),
      trace: expect.objectContaining({ resolution: 'adapted', reasonRegions: ['knee'] }),
    }));
  });

  it('accepts only an explicitly allowlisted cross-primary-muscle limitation variant', () => {
    const source = {
      ...exercise('a', profile({
        knee: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'b' } },
      })),
      target: { ...base.target, primaryMuscle: 'rear_deltoid' as const },
      movement: { ...base.movement, pattern: 'horizontal_pull' as const },
      substitution: { similarExerciseIds: [], limitationVariantIds: ['b'] },
    };
    const candidate = {
      ...exercise('b'),
      target: { ...base.target, primaryMuscle: 'upper_back' as const },
      movement: { ...base.movement, pattern: 'horizontal_pull' as const },
    };

    expect(resolve({ source, candidates: [candidate] })).toEqual(expect.objectContaining({
      status: 'RESOLVED',
      exercise: expect.objectContaining({ id: 'b' }),
    }));

    const withoutApproval = {
      ...source,
      substitution: { similarExerciseIds: [], limitationVariantIds: [] },
    };
    expect(resolve({ source: withoutApproval, candidates: [candidate] })).toEqual(expect.objectContaining({
      status: 'FAILED', reasonCodes: ['LIMITATION_ADAPTATION_INVALID'],
    }));
  });

  it('still rejects an explicitly listed limitation variant with a different movement pattern', () => {
    const source = {
      ...exercise('a', profile({
        knee: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'b' } },
      })),
      movement: { ...base.movement, pattern: 'horizontal_pull' as const },
      substitution: { similarExerciseIds: [], limitationVariantIds: ['b'] },
    };
    const candidate = {
      ...exercise('b'),
      movement: { ...base.movement, pattern: 'vertical_pull' as const },
    };

    expect(resolve({ source, candidates: [candidate] })).toEqual(expect.objectContaining({
      status: 'FAILED', reasonCodes: ['LIMITATION_ADAPTATION_INVALID'],
    }));
  });

  it('fails closed when an adaptation target is itself not directly safe', () => {
    const source = exercise('a', profile({
      knee: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'b' } },
    }));
    const candidate = exercise('b', profile({
      knee: { status: 'avoid', substituteExerciseIds: ['a'], candidateStatus: 'ready' },
    }));
    expect(resolve({ source, candidates: [candidate] })).toEqual(expect.objectContaining({
      status: 'FAILED', reasonCodes: ['LIMITATION_ADAPTATION_INVALID'],
    }));
  });

  it('fails closed when an adaptation target does not exist', () => {
    const source = exercise('a', profile({
      knee: {
        status: 'adapt',
        adaptation: { kind: 'exercise_variant', exerciseId: 'nonexistent-exercise' },
      },
    }));
    expect(resolve({ source })).toEqual(expect.objectContaining({
      status: 'FAILED', reasonCodes: ['LIMITATION_ADAPTATION_INVALID'],
    }));
  });

  it('intersects two simultaneous limitations', () => {
    expect(resolve({ source: exercise('a'), regions: ['knee', 'shoulder'] })).toEqual(expect.objectContaining({
      status: 'RESOLVED', trace: expect.objectContaining({ regionsEvaluated: ['knee', 'shoulder'] }),
    }));
  });

  it('rejects a candidate compatible for knee but avoid for shoulder', () => {
    const source = exercise('a', profile({
      knee: { status: 'avoid', substituteExerciseIds: ['b'], candidateStatus: 'ready' },
    }));
    const candidate = exercise('b', profile({
      shoulder: { status: 'avoid', substituteExerciseIds: [], candidateStatus: 'missing_exercise_candidate' },
    }));
    expect(resolve({ source, candidates: [candidate], regions: ['knee', 'shoulder'] })).toEqual(expect.objectContaining({
      status: 'FAILED', reasonCodes: ['NO_SAFE_SUBSTITUTION'],
    }));
  });

  it.each([
    ['missing', undefined, 'LIMITATION_PROFILE_MISSING'],
    ['not approved', { ...profile(), reviewStatus: 'draft' }, 'LIMITATION_PROFILE_NOT_APPROVED'],
    ['unsupported protocol', { ...profile(), protocolVersion: 'musculoskeletal-v2' }, 'LIMITATION_PROFILE_VERSION_UNSUPPORTED'],
    ['incomplete', { ...profile(), regions: {} }, 'LIMITATION_PROFILE_INVALID'],
  ])('fails closed for a %s profile', (_label, limitationProfile, reasonCode) => {
    expect(validateLimitationProfile('a', limitationProfile)).toEqual({ valid: false, reasonCode });
  });

  it('returns UNMAPPED_LIMITATION_REGION instead of ignoring other', () => {
    expect(mapQuestionnaireLimitations(completeAnswers({
      specialConditions: ['musculoskeletal_limitation'], limits: ['other'], limitationImpact: 'mild',
    }))).toEqual({ status: 'UNMAPPED', reasonCodes: ['UNMAPPED_LIMITATION_REGION'] });
  });

  it('does not recurse through an A ↔ B cycle', () => {
    const source = exercise('a', profile({
      knee: { status: 'avoid', substituteExerciseIds: ['b'], candidateStatus: 'ready' },
    }));
    const candidate = exercise('b', profile({
      knee: { status: 'avoid', substituteExerciseIds: ['a'], candidateStatus: 'ready' },
    }));
    const result = resolve({ source, candidates: [candidate] });
    expect(result).toEqual(expect.objectContaining({ status: 'FAILED', reasonCodes: ['NO_SAFE_SUBSTITUTION'] }));
    if (result.status === 'FAILED') expect(result.candidatesEvaluated).toHaveLength(1);
  });

  it('rejects a candidate from the unreviewed 40 when it has no profile', () => {
    const source = exercise('a', profile({
      knee: { status: 'avoid', substituteExerciseIds: ['unreviewed'], candidateStatus: 'ready' },
    }));
    const result = resolve({ source, candidates: [exercise('unreviewed', null)] });
    expect(result).toEqual(expect.objectContaining({ status: 'FAILED', reasonCodes: ['NO_SAFE_SUBSTITUTION'] }));
    if (result.status === 'FAILED') {
      expect(result.candidatesEvaluated[0].reasonCodes).toContain('LIMITATION_PROFILE_MISSING');
    }
  });

  it('accepts a structurally audited professional_review profile', () => {
    const professional = {
      ...profile(),
      reviewBasis: 'professional_review',
      reviewedAt: { seconds: 1, nanoseconds: 0 },
      reviewedBy: 'review-record-1',
    };
    expect(validateLimitationProfile('a', professional)).toEqual(expect.objectContaining({ valid: true }));
  });
});
