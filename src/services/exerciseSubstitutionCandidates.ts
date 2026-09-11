/**
 * Pure, RN/Firebase-free half of the Manual Substitution client surface —
 * split out of `exerciseSubstitution.ts` for the same reason
 * `workoutScreenPlan.ts` was split out of `WorkoutScreen.tsx` (see that
 * file's doc comment): this project's Vitest config only collects `.test.ts`
 * files in a Node environment, and importing `userProfile.ts`/`firebase/functions`
 * at module scope pulls in React Native at import time, which cannot load
 * outside RN. Zero behavior change — `exerciseSubstitution.ts` re-exports
 * these same functions.
 */
import { type EquipmentContext } from '../workoutPrescription/equipment';
import type { LimitationRegionId } from '../types/exercise';
import { MANUAL_SUBSTITUTION_CATALOG } from '../workoutPrescription/manualSubstitutionCatalog';
import {
  evaluateRevertToAnchor,
  resolveManualSubstitutionCandidates,
  type ManualSubstitutionCandidateEvaluation,
} from '../workoutPrescription/manualSubstitutionResolver';

export interface ManualSubstitutionUserContext {
  regions: LimitationRegionId[];
  equipmentContext: EquipmentContext;
}

/**
 * Preview-only candidate list for the substitution sheet — runs the same
 * shared resolver the backend runs, against the same static catalog the rest
 * of the client prescription pipeline already trusts for display. This is
 * NEVER the authority for what gets applied; `applyExerciseSubstitution`
 * (in `exerciseSubstitution.ts`) independently re-validates server-side.
 * `maxResults` defaults to 3 (product decision), never padded with an
 * ineligible candidate to force a count.
 */
export function resolveDisplayCandidates(input: {
  anchorExerciseId: string;
  userContext: ManualSubstitutionUserContext;
  effectiveExerciseIdsInSession: ReadonlySet<string>;
  maxResults?: number;
}): ManualSubstitutionCandidateEvaluation[] {
  const result = resolveManualSubstitutionCandidates({
    anchorExerciseId: input.anchorExerciseId,
    catalog: MANUAL_SUBSTITUTION_CATALOG,
    regions: input.userContext.regions,
    equipmentContext: input.userContext.equipmentContext,
    effectiveExerciseIdsInSession: input.effectiveExerciseIdsInSession,
    maxResults: input.maxResults,
  });
  return result.status === 'RESOLVED' ? result.candidates : [];
}

/** Whether "voltar ao original" should be offered for this anchor right now. */
export function canRevertToAnchor(input: {
  anchorExerciseId: string;
  userContext: ManualSubstitutionUserContext;
  effectiveExerciseIdsInSession: ReadonlySet<string>;
}): boolean {
  return evaluateRevertToAnchor({
    anchorExerciseId: input.anchorExerciseId,
    catalog: MANUAL_SUBSTITUTION_CATALOG,
    regions: input.userContext.regions,
    equipmentContext: input.userContext.equipmentContext,
    effectiveExerciseIdsInSession: input.effectiveExerciseIdsInSession,
  }).eligible;
}

export function exerciseDisplayName(exerciseId: string, locale: 'ptBR' | 'en' | 'es'): string {
  return MANUAL_SUBSTITUTION_CATALOG.get(exerciseId)?.name[locale] ?? exerciseId;
}

export function exerciseDisplayTarget(exerciseId: string): string {
  return MANUAL_SUBSTITUTION_CATALOG.get(exerciseId)?.target.primaryMuscle ?? '';
}
