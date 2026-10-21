import { manualSubstitutionEquipmentContext } from '../workoutPrescription/equipment';
import type { TemplateEnvironment } from '../workoutPrescription/types';
import type { ManualSubstitutionUserContext } from './exerciseSubstitutionCandidates';
import { getLatestQuestionnaire } from './userProfile';

export type { ManualSubstitutionUserContext } from './exerciseSubstitutionCandidates';

export async function loadManualSubstitutionUserContext(
  uid: string,
  environment: TemplateEnvironment,
  templateSourceVersion: unknown,
): Promise<ManualSubstitutionUserContext | null> {
  const questionnaire = await getLatestQuestionnaire(uid);
  if (!questionnaire?.answers) return null;
  return {
    equipmentContext: manualSubstitutionEquipmentContext(questionnaire.answers, environment, templateSourceVersion),
  };
}
