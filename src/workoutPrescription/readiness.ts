import type { PrescriptionResult } from './types';

export type WorkoutReadinessGateStatus = 'idle' | 'checking' | 'ready' | 'needsQuestionnaire';

/**
 * Single source of truth for "does this terminal prescription outcome mean
 * we don't even have enough data to decide" — reuses the SAME
 * `PrescriptionResult.status` the engine itself produces from
 * `prescriptionInputErrors`/`sanitizeAnswersForEngine`
 * (workoutPrescription/input.ts), never a second, independently-maintained
 * list of "required fields". Only `NEEDS_QUESTIONNAIRE_UPDATE` means that —
 * every other terminal status (a safety `BLOCKED`/`REQUIRES_CLEARANCE`, a
 * catalog/config error, `MISSING_TEMPLATE`) still means `'ready'`: AppShell's
 * existing degraded UI already handles those correctly, and this gate's job
 * is only to keep the app OUT of that degraded UI for the one failure mode
 * that's actually fixable by the user right now (answer the missing
 * question), not to second-guess the Prescription/Safety layer's other
 * outcomes.
 *
 * Kept in its own module, with no React/React Native import, on purpose —
 * same reason `input.ts`'s `prescriptionInputErrors` is pure: it lets this
 * decision be unit-tested directly (readiness.test.ts) without pulling
 * react-native's Flow-syntax sources into a Node-only Vitest run (see
 * `useWorkoutReadinessGate.ts`, which re-exports this for its existing
 * callers).
 */
export function readinessStatusForPrescription(
  status: PrescriptionResult['status'],
): 'ready' | 'needsQuestionnaire' {
  return status === 'NEEDS_QUESTIONNAIRE_UPDATE' ? 'needsQuestionnaire' : 'ready';
}
