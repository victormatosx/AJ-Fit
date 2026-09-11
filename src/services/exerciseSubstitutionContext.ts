import { getLatestQuestionnaire } from './userProfile';
import { equipmentContextFor } from '../workoutPrescription/equipment';
import { mapQuestionnaireLimitations } from '../workoutPrescription/limitationResolver';
import type { TemplateEnvironment } from '../workoutPrescription/types';
import type { ManualSubstitutionUserContext } from './exerciseSubstitutionCandidates';

export type { ManualSubstitutionUserContext } from './exerciseSubstitutionCandidates';

/**
 * Split out of `exerciseSubstitution.ts` (Fase 6 fix): that module imports
 * `firebase/functions`/`../lib/firebaseFunctions`, which calls `getFunctions()`
 * EAGERLY at module load time — fine for a screen already running inside a
 * fully-initialized app, but importing it from `services/workoutExecutions.ts`
 * (needed to materialize permanent substitution preferences at execution
 * creation) broke every test that imports `workoutExecutions.ts` without a
 * mocked Firebase Functions app. This file needs only Firestore reads
 * (`getLatestQuestionnaire`) — no Functions dependency — so it can be
 * imported from `workoutExecutions.ts` without pulling in `getFunctions()`.
 * `exerciseSubstitution.ts` re-exports this same function unchanged for
 * every existing caller (`AppShell.tsx`).
 */
export async function loadManualSubstitutionUserContext(
  uid: string,
  environment: TemplateEnvironment,
): Promise<ManualSubstitutionUserContext | null> {
  const questionnaire = await getLatestQuestionnaire(uid);
  if (!questionnaire?.answers) return null;
  const limitationMapping = mapQuestionnaireLimitations(questionnaire.answers);
  if (limitationMapping.status !== 'MAPPED') return null;
  return {
    regions: limitationMapping.regions,
    equipmentContext: equipmentContextFor(questionnaire.answers, environment),
  };
}
