import { generateWorkoutPrescription } from './engine';
import { generateWorkoutPrescriptionV127 } from './engineV127';
import { resolveGenerationVersion, type PrescriptionGenerationVersion } from './generationVersion';
import type { PrescriptionGenerationContext, PrescriptionResult, QuestionnaireAnswers } from './types';
import type { CurrentTrainingLevel } from '../workoutLifecycle/types';

/**
 * Fase 9 §2 — the ONE call site that turns `resolveGenerationVersion`'s
 * decision into an actual engine invocation. No other file should ever
 * branch on `'v2' | 'v1.27'` — see `noIndependentGenerationVersionDecisions.
 * test.ts` for the structural guard proving that.
 *
 * `currentTrainingLevel` is required (not optional) on purpose: both
 * engines need it (`engine.ts` derives it internally today only insofar as
 * `answers.level` already reflects it via `effectivePrescriptionInputsFromAnswers`
 * at the caller boundary; `engineV127.ts` takes it explicitly, Fase 7). This
 * function does not itself override `answers.level` for the v2 path — that
 * remains each production caller's existing responsibility (Fase 7 already
 * wired this for the real v2 callers) — it only forwards the value to
 * `engineV127.ts`, which is the one pipeline that needs it as an explicit
 * argument.
 */
export function generateWorkoutPrescriptionRouted(
  rawAnswers: QuestionnaireAnswers,
  currentTrainingLevel: CurrentTrainingLevel,
  context: PrescriptionGenerationContext = {},
  overrideVersion?: PrescriptionGenerationVersion,
): PrescriptionResult {
  const version = resolveGenerationVersion(overrideVersion);
  if (version === 'v1.27') {
    return generateWorkoutPrescriptionV127(rawAnswers, currentTrainingLevel, context);
  }
  return generateWorkoutPrescription(rawAnswers, context);
}

/**
 * Fase 10 (cutover) — the one indirect access point a production PERSISTENCE
 * orchestrator (`services/workoutPrograms.ts`) may call to learn which
 * version is active, BEFORE it knows whether it needs to do a v2-shaped
 * (async Firestore template fetch, then a synchronous engine call) or
 * v1.27-shaped (no fetch — the engine resolves its own local template)
 * sequence. It exists only because that pre-engine branching (which async
 * template-loading strategy to run) cannot itself be expressed as a single
 * `generateWorkoutPrescriptionRouted` call — the loading strategy has to be
 * chosen first. Still only ever delegates to `resolveGenerationVersion`;
 * still the only two functions in this file that call it.
 */
export function resolveActiveGenerationVersion(override?: PrescriptionGenerationVersion): PrescriptionGenerationVersion {
  return resolveGenerationVersion(override);
}
