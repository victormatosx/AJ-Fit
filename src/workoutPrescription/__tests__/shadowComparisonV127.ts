import { generateWorkoutPrescription } from '../engine';
import { generateWorkoutPrescriptionV127 } from '../engineV127';
import type { CurrentTrainingLevel } from '../../workoutLifecycle/types';
import type { QuestionnaireAnswers } from '../types';

/**
 * Fase 9 §15 — test-only shadow-comparison harness. Generates a v2 and a
 * v1.27 plan from the SAME answers and reports structured differences.
 * Equality is never asserted or required — the two libraries are
 * independently authored template sets (T001-T090 vs T001-T102) with no
 * claim of prescription parity. This exists purely to make QA differences
 * inspectable, not to gate anything. Never imported by production code.
 */
export interface ShadowComparisonResult {
  v2Status: string;
  v127Status: string;
  templateIdDiffers: boolean;
  v2TemplateId?: string;
  v127TemplateId?: string;
  sessionCountDiffers: boolean;
  v2SessionCount?: number;
  v127SessionCount?: number;
  exerciseSetDiffers: boolean;
  v2ExerciseIds?: string[];
  v127ExerciseIds?: string[];
  doseShapeDiffers: boolean;
  versionsDiffer: boolean;
}

export function shadowCompare(
  answers: QuestionnaireAnswers,
  currentTrainingLevel: CurrentTrainingLevel,
): ShadowComparisonResult {
  const v2 = generateWorkoutPrescription(answers);
  const v127 = generateWorkoutPrescriptionV127(answers, currentTrainingLevel);

  const v2Ids = v2.status === 'SUCCESS' ? v2.plan.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId)) : undefined;
  const v127Ids = v127.status === 'SUCCESS' ? v127.plan.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId)) : undefined;
  const v2Doses = v2.status === 'SUCCESS' ? v2.plan.sessions.flatMap((s) => s.exercises.map((e) => (e.reps ? 'reps' : e.duration ? 'duration' : e.distance ? 'distance' : e.cycleRange ? 'cycles' : 'none'))) : undefined;
  const v127Doses = v127.status === 'SUCCESS' ? v127.plan.sessions.flatMap((s) => s.exercises.map((e) => (e.reps ? 'reps' : e.duration ? 'duration' : e.distance ? 'distance' : e.cycleRange ? 'cycles' : 'none'))) : undefined;

  return {
    v2Status: v2.status,
    v127Status: v127.status,
    templateIdDiffers: (v2.status === 'SUCCESS' ? v2.plan.templateId : undefined) !== (v127.status === 'SUCCESS' ? v127.plan.templateId : undefined),
    v2TemplateId: v2.status === 'SUCCESS' ? v2.plan.templateId : undefined,
    v127TemplateId: v127.status === 'SUCCESS' ? v127.plan.templateId : undefined,
    sessionCountDiffers: (v2.status === 'SUCCESS' ? v2.plan.sessions.length : -1) !== (v127.status === 'SUCCESS' ? v127.plan.sessions.length : -1),
    v2SessionCount: v2.status === 'SUCCESS' ? v2.plan.sessions.length : undefined,
    v127SessionCount: v127.status === 'SUCCESS' ? v127.plan.sessions.length : undefined,
    exerciseSetDiffers: JSON.stringify(v2Ids) !== JSON.stringify(v127Ids),
    v2ExerciseIds: v2Ids,
    v127ExerciseIds: v127Ids,
    doseShapeDiffers: JSON.stringify(v2Doses) !== JSON.stringify(v127Doses),
    versionsDiffer: (v2.status === 'SUCCESS' ? v2.plan.versions.templateLibrary : undefined) !== (v127.status === 'SUCCESS' ? v127.plan.versions.templateLibrary : undefined),
  };
}
