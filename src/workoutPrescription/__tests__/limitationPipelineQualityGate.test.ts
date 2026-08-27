import { describe, expect, it } from 'vitest';

import templatesJson from '../../../docs/workouts/AJ_Fit_T001_T090_workouts_canonical_v1_3.json';
import { LIMITATION_REGION_IDS, type LimitationRegionId } from '../../types/exercise';
import { equipmentContextFor, isExerciseExecutable } from '../equipment';
import { composeTemplate } from '../composition';
import { generateWorkoutPrescription } from '../engine';
import {
  resolveExerciseLimitationsFromCandidates,
  validateLimitationProfile,
  type LimitationCatalogExercise,
} from '../limitationResolver';
import type { CanonicalTemplate, QuestionnaireAnswers } from '../types';
import { answersForTemplate, completeAnswers, realLimitationCatalogFixture } from './fixtures';

interface TemplateArtifact {
  workouts: CanonicalTemplate[];
}

const templates = (templatesJson as unknown as TemplateArtifact).workouts;
const catalogArray = realLimitationCatalogFixture();
const catalog = new Map<string, LimitationCatalogExercise>(
  catalogArray.map((exercise) => [exercise.id, exercise]),
);
const usedExerciseIds = [...new Set(templates.flatMap((template) =>
  template.sessions.flatMap((session) =>
    session.exercises.map((exercise) => exercise.exercise_id))))].sort();

function limitationAnswersForTemplate(
  template: CanonicalTemplate,
  regions: LimitationRegionId[],
): QuestionnaireAnswers {
  const base = answersForTemplate(template);
  const specialConditions: QuestionnaireAnswers['specialConditions'] =
    base.specialConditions.includes('none')
      ? ['musculoskeletal_limitation']
      : [...base.specialConditions, 'musculoskeletal_limitation'];
  return {
    ...base,
    specialConditions,
    limits: regions,
  };
}

describe('Pipeline limitation quality gate', () => {
  it('completes all T001-T090 × 7 region pipelines deterministically and safely', () => {
    expect(templates).toHaveLength(90);
    let executions = 0;
    let omissions = 0;
    for (const template of templates) {
      for (const region of LIMITATION_REGION_IDS) {
        const answers = limitationAnswersForTemplate(template, [region]);
        const first = generateWorkoutPrescription(answers, {
          template,
          exerciseCatalog: catalogArray,
        });
        const second = generateWorkoutPrescription(answers, {
          template,
          exerciseCatalog: catalogArray,
        });
        executions += 1;
        expect(second).toEqual(first);
        expect(first.status, `${template.id}:${region}`).toBe('SUCCESS');
        if (first.status !== 'SUCCESS') continue;

        omissions += first.plan.trace.exerciseOmissions?.length ?? 0;
        const equipment = equipmentContextFor(answers, template.profile.environment);
        for (const session of first.plan.sessions) {
          expect(session.exercises.length, `${template.id}:${session.name}:${region}`).toBeGreaterThanOrEqual(1);
          const sourceByFinalId = new Map<string, string>();
          for (const item of session.exercises) {
            const exercise = catalog.get(item.exerciseId);
            expect(exercise, item.exerciseId).toBeDefined();
            if (!exercise) continue;
            expect(isExerciseExecutable(exercise, equipment), `${template.id}:${item.exerciseId}`).toBe(true);
            const validation = validateLimitationProfile(exercise.id, exercise.limitationProfile);
            expect(validation.valid, exercise.id).toBe(true);
            if (validation.valid) {
              expect(['compatible', 'not_applicable']).toContain(
                validation.profile.regions[region].status,
              );
            }
            const previousSource = sourceByFinalId.get(item.exerciseId);
            expect(previousSource == null || previousSource === item.sourceExerciseId).toBe(true);
            sourceByFinalId.set(item.exerciseId, item.sourceExerciseId);
          }
        }
      }
    }
    expect(executions).toBe(630);
    expect(omissions).toBeGreaterThanOrEqual(0);
  });

  it('classifies all 9,017 reachable exercise × non-empty region subsets as safe or explicitly omittable', () => {
    expect(usedExerciseIds).toHaveLength(71);
    let total = 0;
    let invalidConfiguration = 0;
    let composedOutcomes = 0;
    const compositionAnswers = completeAnswers({
      specialConditions: ['musculoskeletal_limitation'],
    });
    for (const exerciseId of usedExerciseIds) {
      for (let mask = 1; mask < (1 << LIMITATION_REGION_IDS.length); mask += 1) {
        const regions = LIMITATION_REGION_IDS.filter((_, index) => (mask & (1 << index)) !== 0);
        const first = resolveExerciseLimitationsFromCandidates({
          exerciseId,
          regions,
          catalog,
          isExecutable: () => true,
        });
        const second = resolveExerciseLimitationsFromCandidates({
          exerciseId,
          regions,
          catalog,
          isExecutable: () => true,
        });
        total += 1;
        expect(second).toEqual(first);
        const slotTemplate: CanonicalTemplate = {
          ...templates[0],
          profile: { ...templates[0].profile, environment: 'gym' },
          sessions: [{
            name: 'Limitation slot gate',
            type: 'strength',
            exercises: [{ name: exerciseId, exercise_id: exerciseId, sets: 2, reps: '8-12' }],
          }],
        };
        const composed = composeTemplate(slotTemplate, { ...compositionAnswers, limits: regions }, {
          environment: 'gym',
          limitationRegions: regions,
          exerciseCatalog: catalogArray,
          safety: {
            status: 'ADAPTED',
            reasons: ['MUSCULOSKELETAL_ADAPTATION_REQUIRED'],
            requiredModifierIds: [],
            protectedConstraints: [],
          },
        });
        expect(['COMPOSED', 'NO_EXECUTABLE_SESSION']).toContain(composed.status);
        if (composed.status === 'COMPOSED') {
          expect(composed.sessions[0].exercises).toHaveLength(1);
        } else if (composed.status === 'NO_EXECUTABLE_SESSION') {
          expect(composed.exerciseOmissions).toEqual([
            expect.objectContaining({
              event: 'workout_exercise_omitted',
              sourceExerciseId: exerciseId,
            }),
          ]);
        }
        composedOutcomes += 1;
        if (first.status === 'FAILED') {
          expect(first.failureKind).toBe('NO_SAFE_CANDIDATE');
          if (first.failureKind === 'INVALID_CONFIGURATION') invalidConfiguration += 1;
          continue;
        }
        const validation = validateLimitationProfile(
          first.exercise.id,
          first.exercise.limitationProfile,
        );
        expect(validation.valid).toBe(true);
        if (validation.valid) {
          for (const region of regions) {
            expect(['compatible', 'not_applicable']).toContain(
              validation.profile.regions[region].status,
            );
          }
        }

      }
    }
    expect(total).toBe(9_017);
    expect(composedOutcomes).toBe(9_017);
    expect(invalidConfiguration).toBe(0);
  });

  it('handles all 29 formerly fatal home pairs without selecting unavailable equipment', () => {
    const cases: ReadonlyArray<readonly [string, LimitationRegionId]> = [
      ...(['back', 'shoulder', 'wrist'] as const).map((region) => ['dumbbell-lateral-raise', region] as const),
      ...(['back', 'shoulder', 'elbow', 'wrist'] as const).map((region) => ['dumbbell-overhead-triceps-extension', region] as const),
      ...(['back', 'wrist'] as const).map((region) => ['dumbbell-shoulder-press', region] as const),
      ...(['back', 'wrist'] as const).map((region) => ['incline-dumbbell-bench-press', region] as const),
      ...(['knee', 'hip', 'back', 'ankle_foot'] as const).map((region) => ['mini-band-hip-abduction', region] as const),
      ['one-arm-dumbbell-row', 'back'],
      ['resistance-band-lat-pulldown', 'back'],
      ['resistance-band-shoulder-press', 'back'],
      ...(['hip', 'back'] as const).map((region) => ['slider-leg-curl', region] as const),
      ...(['knee', 'hip', 'back', 'ankle_foot'] as const).map((region) => ['supported-hip-abduction', region] as const),
      ...(['hip', 'back', 'ankle_foot'] as const).map((region) => ['supported-standing-leg-curl', region] as const),
      ...(['back', 'shoulder'] as const).map((region) => ['triceps-rope-pushdown', region] as const),
    ];
    expect(cases).toHaveLength(29);
    const answers = completeAnswers({
      place: 'home',
      equipment: ['bodyweight', 'dumbbells', 'bands', 'bench_or_box', 'barbell'],
    });
    const equipment = equipmentContextFor(answers, 'home');
    for (const [exerciseId, region] of cases) {
      const result = resolveExerciseLimitationsFromCandidates({
        exerciseId,
        regions: [region],
        catalog,
        isExecutable: (exercise) => isExerciseExecutable(exercise, equipment),
      });
      if (result.status === 'FAILED') {
        expect(result.failureKind, `${exerciseId}:${region}`).toBe('NO_SAFE_CANDIDATE');
      } else {
        expect(isExerciseExecutable(result.exercise, equipment), `${exerciseId}:${region}`).toBe(true);
      }
    }
  });
});
