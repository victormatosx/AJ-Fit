import { getLatestQuestionnaire } from './userProfile';
import { manualSubstitutionEquipmentContext } from '../workoutPrescription/equipment';
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
 *
 * `templateSourceVersion` (equipment-inventory follow-up audit) is the
 * ACTIVE PROGRAM's own authoritative version — never a default, never
 * derived from `answers.equipment` — so a v1.27 `home` program gets the
 * same `unrestrictedEquipmentContext` every other v1.27 lifecycle stage
 * already uses, instead of collapsing to `{'bodyweight'}` because the
 * equipment-inventory question is no longer shown. See
 * `manualSubstitutionEquipmentContext` for the full rationale.
 */
export async function loadManualSubstitutionUserContext(
  uid: string,
  environment: TemplateEnvironment,
  templateSourceVersion: unknown,
): Promise<ManualSubstitutionUserContext | null> {
  const questionnaire = await getLatestQuestionnaire(uid);
  if (!questionnaire?.answers) return null;
  const limitationMapping = mapQuestionnaireLimitations(questionnaire.answers);
  if (limitationMapping.status !== 'MAPPED') return null;
  return {
    regions: limitationMapping.regions,
    equipmentContext: manualSubstitutionEquipmentContext(questionnaire.answers, environment, templateSourceVersion),
  };
}
