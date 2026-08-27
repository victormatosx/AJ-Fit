import { describe, expect, it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { WORKOUT_TEMPLATES, getTemplateById } from '../catalog';
import { generateWorkoutPrescription } from '../engine';
import { selectTemplate } from '../selection';
import type { CanonicalTemplate, QuestionnaireAnswers } from '../types';
import { completeAnswers, realLimitationCatalogFixture } from './fixtures';

const catalog = realLimitationCatalogFixture();

function oneExerciseTemplate(
  answers: QuestionnaireAnswers,
  exerciseId: string,
): CanonicalTemplate {
  const selection = selectTemplate(answers);
  if (selection.status !== 'SELECTED') throw new Error(selection.reasonCodes.join(','));
  const canonical = getTemplateById(selection.decision.templateId);
  if (!canonical) throw new Error(`template missing:${selection.decision.templateId}`);
  return {
    ...structuredClone(canonical),
    sessions: canonical.sessions.map((session, index) => ({
      ...session,
      name: `Test ${index + 1}`,
      exercises: [{ name: exerciseId, exercise_id: exerciseId, sets: 2, reps: '8-12' }],
    })),
  };
}

function exerciseListTemplate(
  answers: QuestionnaireAnswers,
  exerciseIds: string[],
): CanonicalTemplate {
  const template = oneExerciseTemplate(answers, exerciseIds[0]);
  return {
    ...template,
    sessions: template.sessions.map((session) => ({
      ...session,
      exercises: exerciseIds.map((exerciseId, index) => ({
        name: exerciseId,
        exercise_id: exerciseId,
        sets: index + 2,
        reps: '8-12',
      })),
    })),
  };
}

function limitationAnswers(overrides: Partial<QuestionnaireAnswers> = {}): QuestionnaireAnswers {
  return completeAnswers({
    days: 2,
    specialConditions: ['musculoskeletal_limitation'],
    limits: ['shoulder'],
    limitationImpact: 'mild',
    ...overrides,
  });
}

function generateSingle(
  answers: QuestionnaireAnswers,
  exerciseId = 'machine-flat-bench-press',
) {
  return generateWorkoutPrescription(answers, {
    template: oneExerciseTemplate(answers, exerciseId),
    exerciseCatalog: catalog,
  });
}

describe('Prescription Engine + Limitation Resolver V1', () => {
  it('uses the next deterministic safe candidate when two preferred targets collide', () => {
    const answers = limitationAnswers({ limits: ['knee'] });
    const result = generateWorkoutPrescription(answers, {
      template: exerciseListTemplate(answers, ['goblet-squat', 'barbell-back-squat']),
      exerciseCatalog: catalog,
    });
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      for (const session of result.plan.sessions) {
        expect(session.exercises.map((item) => item.exerciseId)).toEqual([
          'chair-sit-to-stand', 'bodyweight-squat',
        ]);
        expect(session.exercises.map((item) => item.sets)).toEqual([2, 3]);
      }
      expect(result.plan.trace.exerciseOmissions).toEqual([]);
    }
  });

  it('omits a colliding second slot when no safe alternative exists without merging volume', () => {
    const answers = limitationAnswers({ limits: ['knee'] });
    const result = generateWorkoutPrescription(answers, {
      template: exerciseListTemplate(answers, ['plank', 'bird-dog']),
      exerciseCatalog: catalog,
    });
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      for (const session of result.plan.sessions) {
        expect(session.exercises).toEqual([
          expect.objectContaining({ exerciseId: 'dead-bug', sourceExerciseId: 'plank', sets: 2 }),
        ]);
      }
      expect(result.plan.trace.exerciseOmissions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'workout_exercise_omitted',
          sourceExerciseId: 'bird-dog',
          reason: 'COLLISION_NO_ALTERNATIVE',
        }),
      ]));
    }
  });

  it('omits only the unsafe slot and keeps a session with another safe exercise valid', () => {
    const answers = limitationAnswers({ limits: ['knee'] });
    const source = catalog.find((exercise) => exercise.id === 'plank');
    if (!source || !source.limitationProfile || typeof source.limitationProfile !== 'object') {
      throw new Error('plank profile missing');
    }
    const limitationProfile = structuredClone(source.limitationProfile) as {
      regions: Record<string, unknown>;
    } & Record<string, unknown>;
    limitationProfile.regions.knee = {
      status: 'adapt',
      adaptation: { kind: 'exercise_variant', exerciseId: 'nonexistent-exercise' },
    };
    const testCatalog = catalog.map((exercise) => exercise.id === source.id
      ? { ...exercise, limitationProfile }
      : exercise);
    const result = generateWorkoutPrescription(answers, {
      template: exerciseListTemplate(answers, ['plank', 'walking']),
      exerciseCatalog: testCatalog,
    });
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.plan.sessions.every((session) =>
        session.exercises.length === 1
        && session.exercises[0].exerciseId === 'walking'
        && session.exercises[0].sets === 3)).toBe(true);
      expect(result.plan.trace.exerciseOmissions).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceExerciseId: 'plank', reason: 'NO_SAFE_SUBSTITUTION' }),
      ]));
    }
  });

  it('returns controlled NO_EXECUTABLE_SESSION when every slot is omitted', () => {
    const answers = limitationAnswers({ limits: ['knee'] });
    const source = catalog.find((exercise) => exercise.id === 'plank');
    if (!source || !source.limitationProfile || typeof source.limitationProfile !== 'object') {
      throw new Error('plank profile missing');
    }
    const limitationProfile = structuredClone(source.limitationProfile) as {
      regions: Record<string, unknown>;
    } & Record<string, unknown>;
    limitationProfile.regions.knee = {
      status: 'adapt',
      adaptation: { kind: 'exercise_variant', exerciseId: 'nonexistent-exercise' },
    };
    const testCatalog = catalog.map((exercise) => exercise.id === source.id
      ? { ...exercise, limitationProfile }
      : exercise);
    const result = generateWorkoutPrescription(answers, {
      template: oneExerciseTemplate(answers, 'plank'),
      exerciseCatalog: testCatalog,
    });
    expect(result).toEqual(expect.objectContaining({
      status: 'NO_EXECUTABLE_SESSION',
      reasonCodes: expect.arrayContaining(['NO_EXECUTABLE_SESSION:0']),
      trace: expect.objectContaining({
        exerciseOmissions: expect.arrayContaining([
          expect.objectContaining({ sourceExerciseId: 'plank' }),
        ]),
      }),
    }));
  });
  it('consumes the persisted V2 profile shape and applies a real adaptation', () => {
    const answers = limitationAnswers();
    const result = generateSingle(answers);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.sessions.flatMap((session) => session.exercises.map((item) => item.exerciseId)))
      .toEqual(['wall-push-up', 'wall-push-up']);
    expect(result.plan.sessions.every((session) => session.exercises[0].sourceExerciseId === 'machine-flat-bench-press')).toBe(true);
    expect(result.plan.trace.limitationDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        originalExerciseId: 'machine-flat-bench-press',
        finalExerciseId: 'wall-push-up',
        regionsEvaluated: ['shoulder'],
        resolution: 'adapted',
        reasonRegions: ['shoulder'],
        protocolVersion: 'musculoskeletal-v1',
        reviewBasis: 'product_policy',
      }),
    ]));
  });

  it.each([
    ['gym', { place: 'gym', primaryPlace: null, equipment: [] }],
    ['home', { place: 'home', primaryPlace: null, equipment: ['bodyweight'] }],
    ['both→home', { place: 'both', primaryPlace: 'home', equipment: ['bodyweight'] }],
  ] satisfies Array<[string, Partial<QuestionnaireAnswers>]>)('keeps the final adaptation executable in %s', (_label, environment) => {
    const answers = limitationAnswers(environment);
    const result = generateSingle(answers);
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.plan.environment).toBe(environment.place === 'both' ? 'home' : environment.place);
      expect(result.plan.sessions.every((session) => session.exercises[0].exerciseId === 'wall-push-up')).toBe(true);
    }
  });

  it('resolves a former avoid with no persisted substitute using the approved target', () => {
    const answers = limitationAnswers({ limits: ['back'] });
    const result = generateSingle(answers, 'bench-step-up');
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.plan.sessions.every((session) =>
        session.exercises[0].exerciseId === 'supported-low-step-up')).toBe(true);
    }
  });

  it('applies an ordered limitation substitute in the full pipeline and snapshots the decision', () => {
    const answers = limitationAnswers();
    const source = catalog.find((exercise) => exercise.id === 'machine-flat-bench-press');
    if (!source || !source.limitationProfile || typeof source.limitationProfile !== 'object') {
      throw new Error('source profile missing');
    }
    const sourceProfile = structuredClone(source.limitationProfile) as {
      regions: Record<string, unknown>;
    } & Record<string, unknown>;
    sourceProfile.regions.shoulder = {
      status: 'avoid',
      substituteExerciseIds: ['incline-dumbbell-bench-press', 'wall-push-up'],
      candidateStatus: 'ready',
    };
    const testCatalog = catalog.map((exercise) => exercise.id === source.id
      ? { ...exercise, limitationProfile: sourceProfile }
      : exercise);
    const result = generateWorkoutPrescription(answers, {
      template: oneExerciseTemplate(answers, source.id),
      exerciseCatalog: testCatalog,
    });
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.plan.sessions.every((session) => session.exercises[0].exerciseId === 'wall-push-up')).toBe(true);
      expect(result.plan.trace.limitationDecisions[0]).toEqual(expect.objectContaining({
        resolution: 'substituted',
        originalExerciseId: source.id,
        finalExerciseId: 'wall-push-up',
        candidatesEvaluated: [
          expect.objectContaining({ exerciseId: 'incline-dumbbell-bench-press', accepted: false }),
          expect.objectContaining({ exerciseId: 'wall-push-up', accepted: true }),
        ],
      }));
    }
  });

  it('resolves a former adapt-to-adapt case through the approved terminal target', () => {
    const result = generateSingle(limitationAnswers(), 'dumbbell-lateral-raise');
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.plan.sessions.every((session) =>
        session.exercises[0].exerciseId === 'machine-lateral-raise')).toBe(true);
    }
  });

  it('intersects simultaneous regions when both approved rules share a terminal target', () => {
    const answers = limitationAnswers({ limits: ['knee', 'back'] });
    const result = generateSingle(answers, 'barbell-back-squat');
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.plan.sessions.every((session) =>
        session.exercises[0].exerciseId === 'chair-sit-to-stand')).toBe(true);
    }
  });

  it('fails closed for an exercise among the 40 without a profile', () => {
    const unreviewed = catalog.find((exercise) => exercise.limitationProfile == null);
    expect(unreviewed).toBeDefined();
    if (!unreviewed) return;
    const result = generateSingle(limitationAnswers(), unreviewed.id);
    expect(result).toEqual(expect.objectContaining({
      status: 'INVALID_CONFIGURATION',
      reasonCodes: expect.arrayContaining([`LIMITATION_PROFILE_MISSING:${unreviewed.id}`]),
    }));
  });

  it('returns UNMAPPED_LIMITATION_REGION for other', () => {
    const answers = limitationAnswers({ limits: ['other'] });
    const result = generateSingle(answers);
    expect(result).toEqual(expect.objectContaining({
      status: 'INVALID_CONFIGURATION', reasonCodes: ['UNMAPPED_LIMITATION_REGION'],
    }));
  });

  it.each([
    ['Beginner', { level: 'beginner' }],
    ['Duration', { duration: '30' }],
    ['Priority', { muscleFocus: ['chest'] }],
  ] satisfies Array<[string, Partial<QuestionnaireAnswers>]>)('%s runs after resolution without reintroducing the rejected source', (_label, overrides) => {
    const answers = limitationAnswers(overrides);
    const result = generateSingle(answers);
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      const ids = result.plan.sessions.flatMap((session) => session.exercises.map((item) => item.exerciseId));
      expect(ids).not.toContain('machine-flat-bench-press');
      expect(ids.every((id) => id === 'wall-push-up')).toBe(true);
    }
  });

  it('keeps Safety sovereign for special population + musculoskeletal limitation', () => {
    const answers = limitationAnswers({
      sex: 'f',
      specialConditions: ['pregnancy', 'musculoskeletal_limitation'],
      pregnancyScreening: {
        weeks: 20,
        prenatalCare: 'yes',
        exerciseRestriction: 'no',
        complication: 'no',
        warningSigns: ['chest_pain'],
      },
    });
    const result = generateWorkoutPrescription(answers, { exerciseCatalog: catalog });
    expect(result.status).toBe('BLOCKED');
    expect('plan' in result).toBe(false);
  });

  it('supports an adapted special-population template plus limitation resolution', () => {
    const answers = limitationAnswers({
      sex: 'f',
      specialConditions: ['pregnancy', 'musculoskeletal_limitation'],
      pregnancyScreening: {
        weeks: 20,
        prenatalCare: 'yes',
        exerciseRestriction: 'no',
        complication: 'no',
        warningSigns: ['none'],
      },
    });
    const result = generateSingle(answers);
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.plan.population).toBe('pregnancy');
      expect(result.plan.trace.safety.status).toBe('ADAPTED');
      expect(result.plan.trace.unresolvedModifiers).toEqual([]);
    }
  });

  it('does not require profiles for users without musculoskeletal limitations', () => {
    const unreviewed = catalog.find((exercise) => exercise.limitationProfile == null);
    expect(unreviewed).toBeDefined();
    if (!unreviewed) return;
    const answers = completeAnswers({ days: 2 });
    const result = generateWorkoutPrescription(answers, {
      template: oneExerciseTemplate(answers, unreviewed.id),
    });
    expect(result.status).toBe('SUCCESS');
  });

  // Regression for the onboarding crash report. The approved clinical
  // artifact keeps plank -> dead-bug and makes dead-bug terminal for knee.
  describe('plank / knee limitation (onboarding_workout_generation_failed reproduction)', () => {
    it('resolves plank×knee to dead-bug without LIMITATION_ADAPTATION_INVALID', () => {
      const answers = limitationAnswers({ limits: ['knee'] });
      const result = generateSingle(answers, 'plank');
      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        expect(result.plan.sessions.every((session) =>
          session.exercises[0].exerciseId === 'dead-bug')).toBe(true);
      }
    });

    it('documents the approved source rule and terminal target rule', () => {
      const plank = catalog.find((exercise) => exercise.id === 'plank');
      const deadBug = catalog.find((exercise) => exercise.id === 'dead-bug');
      expect(plank?.limitationProfile).toMatchObject({
        regions: { knee: { status: 'adapt', adaptation: { exerciseId: 'dead-bug' } } },
      });
      expect(deadBug?.limitationProfile).toMatchObject({
        regions: { knee: { status: 'not_applicable' } },
      });
    });

    it('generates plank normally when no limitation is declared', () => {
      const answers = completeAnswers({ days: 2 });
      const result = generateSingle(answers, 'plank');
      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        expect(result.plan.sessions.every((session) => session.exercises[0].exerciseId === 'plank')).toBe(true);
      }
    });

    it('generates plank normally for a limitation region it is genuinely compatible with (ankle_foot: not_applicable)', () => {
      const answers = limitationAnswers({ limits: ['ankle_foot'] });
      const result = generateSingle(answers, 'plank');
      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        expect(result.plan.sessions.every((session) => session.exercises[0].exerciseId === 'plank')).toBe(true);
        expect(result.plan.trace.limitationDecisions).toEqual(expect.arrayContaining([
          expect.objectContaining({ originalExerciseId: 'plank', finalExerciseId: 'plank', resolution: 'compatible' }),
        ]));
      }
    });

    it('combines knee and shoulder because both rules use the same terminal target', () => {
      const answers = limitationAnswers({ limits: ['knee', 'shoulder'] });
      const result = generateSingle(answers, 'plank');
      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        expect(result.plan.sessions.every((session) =>
          session.exercises[0].exerciseId === 'dead-bug')).toBe(true);
      }
    });

    it('a genuinely complete adaptation (shoulder + machine-flat-bench-press) still succeeds — the resolver logic itself is sound', () => {
      const result = generateSingle(limitationAnswers({ limits: ['shoulder'] }), 'machine-flat-bench-press');
      expect(result.status).toBe('SUCCESS');
    });
  });

  it('preserves all 90 template IDs and emits only existing exercise IDs', () => {
    expect(WORKOUT_TEMPLATES).toHaveLength(90);
    const knownIds = new Set(EXERCISES_SEED.map((exercise) => exercise.id));
    const result = generateSingle(limitationAnswers());
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.plan.templateId).toBe(oneExerciseTemplate(limitationAnswers(), 'machine-flat-bench-press').id);
      expect(result.plan.sessions.flatMap((session) => session.exercises).every((item) => knownIds.has(item.exerciseId))).toBe(true);
    }
  });
});
