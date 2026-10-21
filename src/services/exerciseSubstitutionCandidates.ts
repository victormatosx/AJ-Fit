import { type EquipmentContext } from '../workoutPrescription/equipment';
import { MANUAL_SUBSTITUTION_CATALOG } from '../workoutPrescription/manualSubstitutionCatalog';
import {
  evaluateRevertToAnchor,
  resolveManualSubstitutionCandidates,
  type ManualSubstitutionCandidateEvaluation,
} from '../workoutPrescription/manualSubstitutionResolver';

export interface ManualSubstitutionUserContext {
  equipmentContext: EquipmentContext;
}

export function resolveDisplayCandidates(input: {
  anchorExerciseId: string;
  userContext: ManualSubstitutionUserContext;
  effectiveExerciseIdsInSession: ReadonlySet<string>;
  maxResults?: number;
}): ManualSubstitutionCandidateEvaluation[] {
  const result = resolveManualSubstitutionCandidates({
    anchorExerciseId: input.anchorExerciseId,
    catalog: MANUAL_SUBSTITUTION_CATALOG,
    equipmentContext: input.userContext.equipmentContext,
    effectiveExerciseIdsInSession: input.effectiveExerciseIdsInSession,
    maxResults: input.maxResults,
  });
  return result.status === 'RESOLVED' ? result.candidates : [];
}

export function canRevertToAnchor(input: {
  anchorExerciseId: string;
  userContext: ManualSubstitutionUserContext;
  effectiveExerciseIdsInSession: ReadonlySet<string>;
}): boolean {
  return evaluateRevertToAnchor({
    anchorExerciseId: input.anchorExerciseId,
    catalog: MANUAL_SUBSTITUTION_CATALOG,
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
