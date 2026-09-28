import { describe, expect, it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { getCanonicalTemplateV127ById } from '../canonicalCatalog';
import { composeTemplateV127 } from '../compositionV127';
import { isExerciseExecutable, unrestrictedEquipmentContext } from '../equipment';
import { loadLocalExerciseCatalogForLimitations } from '../localLimitationCatalog';
import { validateLimitationProfile } from '../limitationResolver';
import { applyMusculoskeletalLimitationV127 } from '../musculoskeletalLimitationV127';
import { V127_TEMPLATE_PROFILES } from '../selectorV127';
import type { FinalWorkoutExercise, FinalWorkoutSession } from '../types';

const catalog = new Map(loadLocalExerciseCatalogForLimitations().map((exercise) => [exercise.id, exercise]));

function profile(exerciseId: string) {
  const validation = validateLimitationProfile(exerciseId, catalog.get(exerciseId)?.limitationProfile);
  if (!validation.valid) throw new Error(`${exerciseId}:${validation.reasonCode}`);
  return validation.profile;
}

function exercise(exerciseId: string, overrides: Partial<FinalWorkoutExercise> = {}): FinalWorkoutExercise {
  return { exerciseId, sourceExerciseId: exerciseId, ...overrides } as FinalWorkoutExercise;
}

function session(exercises: FinalWorkoutExercise[]): FinalWorkoutSession {
  return { name: 'Sessão', exercises } as FinalWorkoutSession;
}

const APPROVED_COMPATIBLE = [
  'resistance-band-lat-pulldown',
  'dumbbell-lateral-raise',
  'mini-band-hip-abduction',
  'supported-hip-abduction',
  'low-step-up',
] as const;

const NON_BACK_BASELINE = {
  'dumbbell-lateral-raise': {
    knee: { status: 'not_applicable' }, hip: { status: 'not_applicable' },
    shoulder: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'machine-lateral-raise' } },
    elbow: { status: 'not_applicable' },
    wrist: { status: 'compatible' },
    ankle_foot: { status: 'not_applicable' },
  },
  'low-step-up': {
    knee: { status: 'compatible' }, hip: { status: 'compatible' },
    shoulder: { status: 'not_applicable' }, elbow: { status: 'not_applicable' }, wrist: { status: 'not_applicable' },
    ankle_foot: { status: 'compatible' },
  },
  'mini-band-hip-abduction': {
    knee: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'seated-hip-abductor-machine' } },
    hip: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'seated-hip-abductor-machine' } },
    shoulder: { status: 'not_applicable' }, elbow: { status: 'not_applicable' }, wrist: { status: 'not_applicable' },
    ankle_foot: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'seated-hip-abductor-machine' } },
  },
  'resistance-band-lat-pulldown': {
    knee: { status: 'not_applicable' }, hip: { status: 'not_applicable' }, shoulder: { status: 'compatible' },
    elbow: { status: 'compatible' }, wrist: { status: 'compatible' }, ankle_foot: { status: 'not_applicable' },
  },
  'supported-hip-abduction': {
    knee: { status: 'compatible' }, hip: { status: 'compatible' },
    shoulder: { status: 'not_applicable' }, elbow: { status: 'not_applicable' }, wrist: { status: 'not_applicable' },
    ankle_foot: { status: 'compatible' },
  },
} as const;

describe('v1.27 spine/Home closure — approved profile changes only', () => {
  it.each(APPROVED_COMPATIBLE)('%s is spine/back compatible', (exerciseId) => {
    expect(profile(exerciseId).regions.back).toEqual({ status: 'compatible' });
  });

  it.each(APPROVED_COMPATIBLE)('%s matches the approved current non-back decisions', (exerciseId) => {
    const { back: _back, ...nonBack } = profile(exerciseId).regions;
    expect(nonBack).toEqual(NON_BACK_BASELINE[exerciseId]);
  });

  it('preserves the explicitly protected spine states', () => {
    expect(profile('dumbbell-overhead-triceps-extension').regions.back).toEqual({
      status: 'adapt',
      adaptation: { kind: 'exercise_variant', exerciseId: 'resistance-band-triceps-pushdown' },
    });
    expect(profile('bench-step-up').regions.back).toEqual({
      status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: 'supported-low-step-up' },
    });
    expect(profile('leg-press-45').regions.back.status).toBe('adapt');
    expect(profile('resistance-band-row').regions.back).toEqual({ status: 'compatible' });
    expect(profile('bent-over-dumbbell-row').regions.back.status).toBe('avoid');
  });
});

describe('v1.27 spine/Home closure — two approved catalog additions', () => {
  it.each([
    ['resistance-band-triceps-pushdown', 'triceps', 'elbow_extension', 'triceps_extension'],
    ['seated-resistance-band-row', 'upper_back', 'horizontal_pull', 'horizontal_back_row'],
  ] as const)('%s is a valid Home candidate with a complete approved profile', (id, muscle, pattern, group) => {
    const seeded = EXERCISES_SEED.find((entry) => entry.id === id);
    expect(seeded).toMatchObject({
      target: { primaryMuscle: muscle }, movement: { pattern }, equipment: ['resistance_band'],
      difficulty: 'beginner', status: 'active', availability: { workoutGeneration: true, substitution: true },
      substitution: { group },
    });
    expect(isExerciseExecutable(seeded!, unrestrictedEquipmentContext('home'))).toBe(true);
    expect(profile(id).regions).toEqual(id === 'resistance-band-triceps-pushdown' ? {
      knee: { status: 'not_applicable' }, hip: { status: 'not_applicable' }, back: { status: 'compatible' },
      shoulder: { status: 'compatible' }, elbow: { status: 'compatible' }, wrist: { status: 'compatible' },
      ankle_foot: { status: 'not_applicable' },
    } : {
      knee: { status: 'not_applicable' }, hip: { status: 'not_applicable' }, back: { status: 'compatible' },
      shoulder: { status: 'compatible' }, elbow: { status: 'compatible' }, wrist: { status: 'compatible' },
      ankle_foot: { status: 'not_applicable' },
    });
  });

  it('uses the band pushdown in Home while preserving the original slot dose', () => {
    const original = exercise('dumbbell-overhead-triceps-extension', { sets: 4, reps: '8-12', intensity: 'moderada' });
    const result = applyMusculoskeletalLimitationV127([session([original])], 'home', ['spine']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises[0]).toMatchObject({
      exerciseId: 'resistance-band-triceps-pushdown', sourceExerciseId: original.exerciseId,
      sets: 4, reps: '8-12', intensity: 'moderada',
    });
  });

  it('uses the seated band row as the normal family fallback when resistance-band-row is already occupied', () => {
    const result = applyMusculoskeletalLimitationV127([
      session([exercise('one-arm-dumbbell-row'), exercise('resistance-band-row')]),
    ], 'home', ['spine']);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') return;
    expect(result.sessions[0].exercises.map((entry) => entry.exerciseId)).toEqual([
      'resistance-band-row', 'seated-resistance-band-row',
    ]);
    expect(result.decisions.at(-1)).toMatchObject({
      exerciseId: 'resistance-band-row', substituteExerciseId: 'seated-resistance-band-row', candidateOrigin: 'family',
    });
  });

  it('keeps pending fail-closed for an active non-spine region', () => {
    const source = catalog.get('resistance-band-triceps-pushdown')!;
    const pendingCatalog = new Map(catalog);
    pendingCatalog.set(source.id, {
      ...source,
      limitationProfile: {
        ...profile(source.id),
        regions: { ...profile(source.id).regions, knee: { status: 'pending' } },
      },
    });
    const result = applyMusculoskeletalLimitationV127([
      session([exercise('resistance-band-triceps-pushdown')]),
    ], 'home', ['knee'], { catalog: pendingCatalog, isExecutable: () => true });
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.decisions[0]).toMatchObject({
      reasonCode: 'PROFILE_COVERAGE_MISSING', sourceReasonCodes: ['LIMITATION_REGION_PENDING'], candidatesEvaluated: [],
    });
  });
});

describe('v1.27 spine/Home closure — all-template audit', () => {
  it('runs all 102 templates with no remaining spine blocker', () => {
    const passed: string[] = [];
    const noSafeTemplates = new Set<string>();
    const coverageTemplates = new Set<string>();
    const blockedExercises = new Set<string>();

    for (const templateProfile of V127_TEMPLATE_PROFILES) {
      const result = composeTemplateV127(getCanonicalTemplateV127ById(templateProfile.id), { limitationRegions: ['spine'] });
      if (result.status === 'COMPOSED') {
        passed.push(templateProfile.id);
        continue;
      }
      for (const decision of result.trace.limitationDecisions) {
        if (decision.outcome !== 'BLOCKED') continue;
        if (decision.reasonCode === 'PROFILE_COVERAGE_MISSING') coverageTemplates.add(templateProfile.id);
        else {
          noSafeTemplates.add(templateProfile.id);
          blockedExercises.add(decision.exerciseId);
        }
      }
    }

    expect(V127_TEMPLATE_PROFILES).toHaveLength(102);
    expect(passed).toHaveLength(102);
    expect(noSafeTemplates.size).toBe(0);
    expect(coverageTemplates.size).toBe(0);
    expect([...blockedExercises]).toEqual([]);
  });
});
