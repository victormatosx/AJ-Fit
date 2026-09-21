/**
 * Exhaustive contextual limitation audit:
 *   - T001-T090 × 7 individual regions through the real prescription engine;
 *   - 71 reachable exercises × all 127 non-empty region subsets through the
 *     contextual candidate selector used by composition.
 *
 * Usage: npx tsx scripts/auditLimitationPipeline.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LIMITATION_REGION_IDS, type LimitationRegionId } from '../src/types/exercise';
import { WORKOUT_TEMPLATES } from '../src/workoutPrescription/catalog';
import { composeTemplate } from '../src/workoutPrescription/composition';
import { equipmentContextFor, isExerciseExecutable } from '../src/workoutPrescription/equipment';
import { generateWorkoutPrescription } from '../src/workoutPrescription/engine';
import {
  resolveExerciseLimitationsFromCandidates,
  type LimitationCatalogExercise,
  type LimitationDecisionTrace,
} from '../src/workoutPrescription/limitationResolver';
import type {
  CanonicalTemplate,
  QuestionnaireAnswers,
  WorkoutExerciseOmissionReason,
} from '../src/workoutPrescription/types';
import {
  answersForTemplate,
  completeAnswers,
  realLimitationCatalogFixture,
} from '../src/workoutPrescription/__tests__/fixtures';

type PipelineOutcome =
  | 'FULLY_PRESERVED'
  | 'ADAPTED'
  | 'ADAPTED_WITH_OMISSIONS'
  | 'NO_EXECUTABLE_SESSION';

const catalogArray = realLimitationCatalogFixture();
const catalog = new Map<string, LimitationCatalogExercise>(
  catalogArray.map((exercise) => [exercise.id, exercise]),
);
const usedExerciseIds = [...new Set(WORKOUT_TEMPLATES.flatMap((template) =>
  template.sessions.flatMap((session) =>
    session.exercises.map((exercise) => exercise.exercise_id))))].sort();

const FORMERLY_FATAL_HOME_PAIRS: ReadonlyArray<readonly [string, LimitationRegionId]> = [
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

function limitationAnswersForTemplate(
  template: CanonicalTemplate,
  regions: LimitationRegionId[],
): QuestionnaireAnswers {
  const base = answersForTemplate(template);
  const specialConditions: QuestionnaireAnswers['specialConditions'] =
    base.specialConditions.includes('none')
      ? ['musculoskeletal_limitation']
      : [...base.specialConditions, 'musculoskeletal_limitation'];
  return { ...base, specialConditions, limits: regions };
}

function main(): void {
  const outcomeCounts: Record<PipelineOutcome, number> = {
    FULLY_PRESERVED: 0,
    ADAPTED: 0,
    ADAPTED_WITH_OMISSIONS: 0,
    NO_EXECUTABLE_SESSION: 0,
  };
  const perRegion = Object.fromEntries(LIMITATION_REGION_IDS.map((region) => [region, {
    completed: 0,
    omissions: 0,
    noExecutableSession: 0,
  }])) as Record<LimitationRegionId, { completed: number; omissions: number; noExecutableSession: number }>;
  const perEnvironment = {
    gym: { completed: 0, omissions: 0, noExecutableSession: 0 },
    home: { completed: 0, omissions: 0, noExecutableSession: 0 },
  };
  const omissionReasons: Record<WorkoutExerciseOmissionReason, number> = {
    NO_SAFE_SUBSTITUTION: 0,
    NO_ENVIRONMENT_CANDIDATE: 0,
    COLLISION_NO_ALTERNATIVE: 0,
    MULTI_LIMITATION_NO_INTERSECTION: 0,
  };
  const omissionsByTemplateSession = new Map<string, number>();
  const fatalCases: Array<{ templateId: string; region: LimitationRegionId; status: string; reasonCodes: string[] }> = [];

  for (const template of WORKOUT_TEMPLATES) {
    for (const region of LIMITATION_REGION_IDS) {
      const answers = limitationAnswersForTemplate(template, [region]);
      const result = generateWorkoutPrescription(answers, { template, exerciseCatalog: catalogArray });
      if (result.status !== 'SUCCESS') {
        if (result.status === 'NO_EXECUTABLE_SESSION') {
          outcomeCounts.NO_EXECUTABLE_SESSION += 1;
          perRegion[region].noExecutableSession += 1;
          perEnvironment[template.profile.environment].noExecutableSession += 1;
        } else {
          fatalCases.push({
            templateId: template.id,
            region,
            status: result.status,
            reasonCodes: result.reasonCodes,
          });
        }
        continue;
      }

      perRegion[region].completed += 1;
      perEnvironment[template.profile.environment].completed += 1;
      const omissions = result.plan.trace.exerciseOmissions ?? [];
      // This script only ever calls the v2 `generateWorkoutPrescription`
      // above, whose trace always carries legacy `LimitationDecisionTrace`
      // objects — the v1.27 union member never appears here.
      const limitationDecisions = result.plan.trace.limitationDecisions as LimitationDecisionTrace[];
      const adapted = limitationDecisions.some((decision) =>
        decision.finalExerciseId !== decision.originalExerciseId);
      const outcome: PipelineOutcome = omissions.length
        ? 'ADAPTED_WITH_OMISSIONS'
        : adapted ? 'ADAPTED' : 'FULLY_PRESERVED';
      outcomeCounts[outcome] += 1;
      perRegion[region].omissions += omissions.length;
      perEnvironment[template.profile.environment].omissions += omissions.length;
      for (const omission of omissions) {
        omissionReasons[omission.reason] += 1;
        const key = `${template.id}:session-${omission.sessionIndex + 1}`;
        omissionsByTemplateSession.set(key, (omissionsByTemplateSession.get(key) ?? 0) + 1);
      }
    }
  }

  let multiResolved = 0;
  let multiOmitted = 0;
  let multiInvalid = 0;
  let compositionOriginalSafe = 0;
  let compositionAdaptedSafe = 0;
  let compositionOmitted = 0;
  let compositionFatal = 0;
  const multiOmissionsByRegionCount: Record<string, number> = {};
  const multiAnswers = completeAnswers({
    specialConditions: ['musculoskeletal_limitation'],
  });
  for (const exerciseId of usedExerciseIds) {
    for (let mask = 1; mask < (1 << LIMITATION_REGION_IDS.length); mask += 1) {
      const regions = LIMITATION_REGION_IDS.filter((_, index) => (mask & (1 << index)) !== 0);
      const result = resolveExerciseLimitationsFromCandidates({
        exerciseId,
        regions,
        catalog,
        isExecutable: () => true,
      });
      if (result.status === 'RESOLVED') multiResolved += 1;
      else if (result.failureKind === 'NO_SAFE_CANDIDATE') {
        multiOmitted += 1;
        const key = String(regions.length);
        multiOmissionsByRegionCount[key] = (multiOmissionsByRegionCount[key] ?? 0) + 1;
      } else multiInvalid += 1;

      const slotTemplate: CanonicalTemplate = {
        ...WORKOUT_TEMPLATES[0],
        profile: { ...WORKOUT_TEMPLATES[0].profile, environment: 'gym' },
        sessions: [{
          name: 'Limitation slot audit',
          type: 'strength',
          exercises: [{ name: exerciseId, exercise_id: exerciseId, sets: 2, reps: '8-12' }],
        }],
      };
      const composed = composeTemplate(slotTemplate, { ...multiAnswers, limits: regions }, {
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
      if (composed.status === 'COMPOSED') {
        const finalExerciseId = composed.sessions[0].exercises[0]?.exerciseId;
        if (finalExerciseId === exerciseId) compositionOriginalSafe += 1;
        else compositionAdaptedSafe += 1;
      } else if (
        composed.status === 'NO_EXECUTABLE_SESSION'
        && composed.exerciseOmissions.length === 1
      ) compositionOmitted += 1;
      else compositionFatal += 1;
    }
  }

  const homeAnswers = completeAnswers({
    place: 'home',
    equipment: ['bodyweight', 'dumbbells', 'bands', 'bench_or_box', 'barbell'],
  });
  const homeEquipment = equipmentContextFor(homeAnswers, 'home');
  const formerlyFatalHomePairs = FORMERLY_FATAL_HOME_PAIRS.map(([exerciseId, region]) => {
    const result = resolveExerciseLimitationsFromCandidates({
      exerciseId,
      regions: [region],
      catalog,
      isExecutable: (exercise) => isExerciseExecutable(exercise, homeEquipment),
    });
    return result.status === 'RESOLVED'
      ? {
          exerciseId,
          region,
          outcome: result.exercise.id === exerciseId ? 'ORIGINAL_SAFE' : 'ADAPTED_SAFE',
          finalExerciseId: result.exercise.id,
          candidateOrigin: result.candidateOrigin,
          executableAtHome: true,
        }
      : {
          exerciseId,
          region,
          outcome: 'OMITTED_NO_SAFE_CANDIDATE',
          finalExerciseId: null,
          candidateOrigin: null,
          executableAtHome: null,
        };
  });

  const totalOmissions = Object.values(omissionReasons).reduce((sum, count) => sum + count, 0);
  const output = {
    generatedAt: new Date().toISOString(),
    candidatePolicy: {
      recursive: false,
      ranking: [
        'preferred target',
        'declared limitation variants',
        'canonical similarExerciseIds',
        'same substitution group + pattern + mechanic',
        'same laterality',
        'stable body position',
        'lower difficulty',
        'exerciseId',
      ],
      terminalStatuses: ['compatible', 'not_applicable'],
      multiLimitationPolicy: 'intersection',
    },
    individualPipeline: {
      total: WORKOUT_TEMPLATES.length * LIMITATION_REGION_IDS.length,
      completed: Object.values(outcomeCounts).reduce((sum, count) => sum + count, 0)
        - outcomeCounts.NO_EXECUTABLE_SESSION,
      outcomes: outcomeCounts,
      totalOmissions,
      omissionReasons,
      noExecutableSession: outcomeCounts.NO_EXECUTABLE_SESSION,
      fatalCases,
      perRegion,
      perEnvironment,
      topTemplateSessionsByOmissions: [...omissionsByTemplateSession.entries()]
        .map(([key, omissions]) => ({ key, omissions }))
        .sort((left, right) => right.omissions - left.omissions || left.key.localeCompare(right.key))
        .slice(0, 20),
    },
    multiLimitationSlots: {
      total: usedExerciseIds.length * ((1 << LIMITATION_REGION_IDS.length) - 1),
      resolvedSafe: multiResolved,
      omittedNoSafeCandidate: multiOmitted,
      invalidConfiguration: multiInvalid,
      omissionsBySelectedRegionCount: multiOmissionsByRegionCount,
      compositionOutcomes: {
        originalSafe: compositionOriginalSafe,
        adaptedSafe: compositionAdaptedSafe,
        omittedNoSafeCandidate: compositionOmitted,
        fatal: compositionFatal,
      },
    },
    formerlyFatalHomePairs: {
      total: formerlyFatalHomePairs.length,
      before: { fatalNoSafeEquipmentSubstitute: formerlyFatalHomePairs.length },
      after: {
        fatalNoSafeEquipmentSubstitute: 0,
        adaptedSafe: formerlyFatalHomePairs.filter((item) => item.outcome === 'ADAPTED_SAFE').length,
        originalSafe: formerlyFatalHomePairs.filter((item) => item.outcome === 'ORIGINAL_SAFE').length,
        omittedNoSafeCandidate: formerlyFatalHomePairs.filter((item) => item.outcome === 'OMITTED_NO_SAFE_CANDIDATE').length,
      },
      cases: formerlyFatalHomePairs,
    },
  };

  const jsonPath = resolve(process.cwd(), 'docs/workout-modifiers/limitation-pipeline-audit.json');
  writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(output, null, 2));
  if (
    fatalCases.length
    || outcomeCounts.NO_EXECUTABLE_SESSION
    || multiInvalid
    || compositionFatal
  ) process.exitCode = 1;
}

main();
