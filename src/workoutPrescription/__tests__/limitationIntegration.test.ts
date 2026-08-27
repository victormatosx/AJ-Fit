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

  it('fails an avoid with no persisted substitute', () => {
    const answers = limitationAnswers({ limits: ['back'] });
    const result = generateSingle(answers, 'bench-step-up');
    expect(result).toEqual(expect.objectContaining({
      status: 'INVALID_CONFIGURATION',
      reasonCodes: expect.arrayContaining(['NO_SAFE_SUBSTITUTION:bench-step-up']),
    }));
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

  it('fails when a real adaptation target requires another adaptation instead of chaining', () => {
    const result = generateSingle(limitationAnswers(), 'dumbbell-lateral-raise');
    expect(result).toEqual(expect.objectContaining({
      status: 'INVALID_CONFIGURATION',
      reasonCodes: expect.arrayContaining(['LIMITATION_ADAPTATION_INVALID:dumbbell-lateral-raise']),
    }));
  });

  it('intersects simultaneous regions and fails conflicting adaptations', () => {
    const answers = limitationAnswers({ limits: ['knee', 'back'] });
    const result = generateSingle(answers, 'barbell-back-squat');
    expect(result).toEqual(expect.objectContaining({
      status: 'INVALID_CONFIGURATION',
      reasonCodes: expect.arrayContaining(['LIMITATION_ADAPTATION_INVALID:barbell-back-squat']),
    }));
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

  // Reproduction for the onboarding crash report: user declares a knee
  // limitation, generation fails with `LIMITATION_ADAPTATION_INVALID:plank`.
  // Root cause is a DATASET gap, not a resolver bug — `plank`'s knee rule
  // adapts to `dead-bug`, but `dead-bug`'s OWN profile marks knee as `avoid`
  // (no substitute), so the candidate is correctly rejected per the
  // documented "no chaining/no improvisation" contract
  // (docs/workout-modifiers/exercise-limitations/20_PHASE5_LIMITATION_RESOLVER.md).
  // This is intentionally NOT "fixed" here: doing so would require a clinical/
  // product decision about which exercise is actually knee-safe in place of
  // `plank`, which is outside what this investigation is authorized to invent.
  describe('plank / knee limitation (onboarding_workout_generation_failed reproduction)', () => {
    it('KNOWN DEBT (baseline key plank:knee, CLASS_1_DATASET_CONTRADICTORY) — reproduces LIMITATION_ADAPTATION_INVALID:plank exactly as reported', () => {
      // Tracked in docs/workout-modifiers/limitation-dataset-baseline.json
      // and docs/workout-modifiers/limitation-remediation-matrix.json under
      // key "plank:knee". This assertion is intentionally the FAIL-CLOSED
      // outcome, not a workaround — the onboarding must never improvise an
      // alternative while this remains an open clinical decision.
      //
      // ⚠️ Once a clinical decision resolves this specific case (see the
      // remediation matrix's `plank:knee` row — reviewStatus transitions
      // NEEDS_CLINICAL_REVIEW → APPROVED → RESOLVED), this test MUST be
      // updated to expect a valid resolution instead, and
      // `docs/workout-modifiers/limitation-dataset-baseline.json` must be
      // regenerated (`npx tsx scripts/generateLimitationDatasetBaseline.ts`)
      // so the quality gate's floor drops with it — never leave this
      // expectation stale once the underlying data changes.
      const answers = limitationAnswers({ limits: ['knee'] });
      const result = generateSingle(answers, 'plank');
      expect(result).toEqual(expect.objectContaining({
        status: 'INVALID_CONFIGURATION',
        reasonCodes: expect.arrayContaining(['LIMITATION_ADAPTATION_INVALID:plank']),
      }));
    });

    it('documents the exact dataset contradiction causing the failure', () => {
      const plank = catalog.find((exercise) => exercise.id === 'plank');
      const deadBug = catalog.find((exercise) => exercise.id === 'dead-bug');
      expect(plank?.limitationProfile).toMatchObject({
        regions: { knee: { status: 'adapt', adaptation: { exerciseId: 'dead-bug' } } },
      });
      // dead-bug's own knee rule is `avoid` with no substitute — it is not
      // actually usable as plank's knee adaptation target, regardless of
      // what plank's own profile claims.
      expect(deadBug?.limitationProfile).toMatchObject({
        regions: { knee: { status: 'avoid', substituteExerciseIds: [] } },
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

    it('combining knee with another region still fails closed for plank — no silent fallback', () => {
      const answers = limitationAnswers({ limits: ['knee', 'shoulder'] });
      const result = generateSingle(answers, 'plank');
      expect(result).toEqual(expect.objectContaining({
        status: 'INVALID_CONFIGURATION',
        reasonCodes: expect.arrayContaining(['LIMITATION_ADAPTATION_INVALID:plank']),
      }));
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
