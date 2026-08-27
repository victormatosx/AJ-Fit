import type { PrescriptionResult } from './types';

export type PrescriptionOutcomeKey =
  | 'requiresClearance'
  | 'blocked'
  | 'needsQuestionnaireUpdate'
  | 'unavailable'
  | 'technicalError';

/**
 * Single source of truth for mapping the engine's real domain status to the
 * i18n key the UI renders — `HomeScreen`, `AppShell`'s
 * `StartWorkoutConfirmation`, and `PlanReadyScreen` all used to repeat this
 * ternary independently, and all three collapsed `INVALID_CONFIGURATION`/
 * `MISSING_EXERCISE` (genuine technical/persistence failures, unrelated to
 * the user's answers) into the same "a safe composition rule has not been
 * defined" copy as `MISSING_TEMPLATE` — which hid what was really a bug
 * behind a message about the user's own answers. `MISSING_TEMPLATE` keeps
 * that copy (it IS literally a missing composition rule); the other two get
 * `technicalError`'s generic, non-technical copy instead.
 */
export function prescriptionOutcomeKey(
  status: Exclude<PrescriptionResult['status'], 'SUCCESS'>,
): PrescriptionOutcomeKey {
  switch (status) {
    case 'REQUIRES_CLEARANCE':
      return 'requiresClearance';
    case 'BLOCKED':
      return 'blocked';
    case 'NEEDS_QUESTIONNAIRE_UPDATE':
      return 'needsQuestionnaireUpdate';
    case 'MISSING_TEMPLATE':
    case 'NO_EXECUTABLE_SESSION':
      return 'unavailable';
    case 'INVALID_CONFIGURATION':
    case 'MISSING_EXERCISE':
      return 'technicalError';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * The manual "GERAR MEU TREINO" action is a fallback, not the normal path
 * (automatic reconciliation in `useWorkoutPrescription` already retries on
 * every app open). It should only ever appear for a technical/persistence
 * failure where retrying the exact same call might actually succeed —
 * never for `NEEDS_QUESTIONNAIRE_UPDATE` (retrying with the same answers
 * fails identically; the user needs to update the questionnaire) or for
 * `BLOCKED`/`REQUIRES_CLEARANCE` (fail-closed safety outcomes a retry
 * button must never appear to bypass).
 */
export function canRetryGeneration(status: PrescriptionResult['status']): boolean {
  return status === 'INVALID_CONFIGURATION' || status === 'MISSING_TEMPLATE' || status === 'MISSING_EXERCISE';
}
