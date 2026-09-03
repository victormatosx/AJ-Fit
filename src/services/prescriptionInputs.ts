import type { QuestionnaireAnswers } from '../workoutPrescription/types';
import {
  buildPrescriptionInputSnapshot,
  questionnaireLevelForCurrentLevel,
  questionnaireAnswersFromPrescriptionInputs,
} from '../workoutLifecycle/prescriptionInputs';
import type { PrescriptionInputSnapshot } from '../workoutLifecycle/types';
import type { PersistedWorkoutLifecycleBundle } from './workoutLifecycle';
import { getQuestionnaireById } from './userProfile';

/**
 * Reads the immutable ProgramInstance snapshot. Pre-8A instances have no
 * snapshot, so they conservatively fall back to the historical questionnaire
 * while overriding only level with the authoritative lifecycle career level.
 * The fallback is never written back into old history; the next real
 * activation persists its own explicit snapshot.
 */
export async function loadAuthoritativePrescriptionInputs(
  uid: string,
  lifecycle: PersistedWorkoutLifecycleBundle,
): Promise<{ answers: QuestionnaireAnswers; snapshot: PrescriptionInputSnapshot; usedLegacyFallback: boolean } | null> {
  const persisted = lifecycle.programInstance.prescriptionInputSnapshot;
  if (persisted) {
    const answers = questionnaireAnswersFromPrescriptionInputs(persisted.inputs);
    answers.level = questionnaireLevelForCurrentLevel(lifecycle.lifecycle.currentTrainingLevel);
    return {
      answers,
      snapshot: persisted,
      usedLegacyFallback: false,
    };
  }

  const questionnaire = await getQuestionnaireById(uid, lifecycle.programInstance.questionnaireId);
  if (!questionnaire) return null;
  const snapshot = buildPrescriptionInputSnapshot({
    answers: questionnaire.answers,
    currentTrainingLevel: lifecycle.lifecycle.currentTrainingLevel,
    source: 'QUESTIONNAIRE_BASELINE',
  });
  return {
    answers: questionnaireAnswersFromPrescriptionInputs(snapshot.inputs),
    snapshot,
    usedLegacyFallback: true,
  };
}
