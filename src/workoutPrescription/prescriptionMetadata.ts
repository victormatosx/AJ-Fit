import type { FinalWorkoutPlan, PrescriptionTrace } from './types';

const EMPTY_TRACE: PrescriptionTrace = {
  selectionReasons: [],
  safety: { status: 'CLEAR', reasons: [], requiredModifierIds: [], protectedConstraints: [] },
  appliedModifiers: [],
  unresolvedModifiers: [],
  conflicts: [],
  substitutions: [],
  compositionDecisions: [],
  validationCodes: [],
};

/**
 * Copy only the current contract when deriving a new cycle from a historical
 * plan. A real plan written by this engine always includes `versions`/`trace`,
 * but a plan loaded straight from Firestore can be a pre-trace-schema
 * historical document (or, in tests, a deliberately partial fixture
 * simulating one) — this must degrade to safe defaults instead of throwing,
 * since historical plans must stay executable without carrying any clinical
 * residue forward.
 */
export function currentPrescriptionMetadata(
  plan: Partial<Pick<FinalWorkoutPlan, 'versions' | 'trace'>>,
): Pick<FinalWorkoutPlan, 'versions' | 'trace'> {
  const { versions, trace = EMPTY_TRACE } = plan;
  const retainedModifier = (id: string) => !id.includes('musculoskeletal');
  const reasons = trace.safety.reasons.filter(reason => String(reason) !== 'MUSCULOSKELETAL_ADAPTATION_REQUIRED');
  const safety = {
    status: trace.safety.status === 'ADAPTED' && reasons.length === 0 ? 'CLEAR' as const : trace.safety.status,
    reasons,
    requiredModifierIds: trace.safety.requiredModifierIds.filter(retainedModifier),
    protectedConstraints: trace.safety.protectedConstraints.filter(value => !value.startsWith('limitation:')),
  };
  const currentTrace: PrescriptionTrace = {
    selectionReasons: [...trace.selectionReasons],
    safety,
    appliedModifiers: trace.appliedModifiers.filter(retainedModifier),
    unresolvedModifiers: trace.unresolvedModifiers.filter(retainedModifier),
    conflicts: trace.conflicts.filter(conflict => retainedModifier(conflict.winnerModifierId) && retainedModifier(conflict.constrainedModifierId)),
    substitutions: trace.substitutions.filter(item => item.reasonCode === 'EQUIPMENT_UNAVAILABLE'),
    compositionDecisions: trace.compositionDecisions.filter(item => String(item.reasonCode) !== 'OMIT_UNSAFE_EXERCISE'),
    validationCodes: [...trace.validationCodes],
    ...(trace.musclePriorityDecisions ? { musclePriorityDecisions: trace.musclePriorityDecisions } : {}),
  };
  return {
    ...(versions ? {
      versions: {
        templateLibrary: versions.templateLibrary,
        selectionEngine: versions.selectionEngine,
        safetyRules: versions.safetyRules,
        modifierRules: versions.modifierRules,
        compositionEngine: versions.compositionEngine,
      },
    } : {}),
    trace: currentTrace,
  } as Pick<FinalWorkoutPlan, 'versions' | 'trace'>;
}
