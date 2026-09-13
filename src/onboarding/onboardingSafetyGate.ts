import type { Quiz } from '../state/AppState';
import { evaluateSafety } from '../workoutPrescription/safety';
import type { SafetyStatus } from '../workoutPrescription/types';
import type { OnboardingStepId } from './steps';

const SAFETY_DECISION_STEPS = new Set<OnboardingStepId>([
  'pregnancyCare',
  'pregnancyWarningSigns',
  'postpartumSigns',
  'postpartumReturnClearance',
  'lipedemaScreening',
  'dizzinessScreening',
  'postSurgicalStatus',
  'medicalRestrictionDetails',
]);

/**
 * Surfaces the prescription engine's existing terminal safety decision at
 * the question that collected it. The engine remains the final authority.
 */
export function onboardingSafetyBlock(
  stepId: OnboardingStepId,
  answers: Quiz,
): Extract<SafetyStatus, 'REQUIRES_CLEARANCE' | 'BLOCKED'> | null {
  if (!SAFETY_DECISION_STEPS.has(stepId)) return null;
  const status = evaluateSafety(answers).status;
  return status === 'REQUIRES_CLEARANCE' || status === 'BLOCKED' ? status : null;
}
