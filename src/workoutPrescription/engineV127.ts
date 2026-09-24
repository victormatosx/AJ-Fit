import { getCanonicalTemplateV127ById } from './canonicalCatalog';
import { composeTemplateV127 } from './compositionV127';
import { prescriptionInputErrors, sanitizeAnswersForEngine } from './input';
import { localLimitationDatasetIdentity } from './limitationDataset';
import { mapQuestionnaireLimitations } from './limitationResolver';
import { evaluateSafety } from './safety';
import { effectiveSafetyV127 } from './safetyV127';
import { selectBaseTemplateV127, selectBaseTemplateV127Input } from './selectorV127';
import {
  PRESCRIPTION_VERSIONS_V127,
  type FinalWorkoutPlan,
  type PrescriptionGenerationContext,
  type PrescriptionResult,
  type QuestionnaireAnswers,
} from './types';
import { validateFinalWorkoutV127 } from './validationV127';
import { normalizeWeekdays } from '../lib/questionnaireSchema';
import { buildWorkoutWeek, trainingSessionIndexes } from './weeklySchedule';
import { questionnaireLevelForCurrentLevel } from '../workoutLifecycle/prescriptionInputs';
import type { CurrentTrainingLevel } from '../workoutLifecycle/types';

/**
 * Fase 9 §1 — the v1.27/T001-T102 authoritative pipeline:
 *
 *   answers + lifecycle
 *     -> normalization        (sanitizeAnswersForEngine, shared boundary)
 *     -> safety                (evaluateSafety, shared — answers-only, no composition coupling)
 *     -> selectBaseTemplateV127ForCurrentTrainingLevel-equivalent (currentTrainingLevel overrides answers.level)
 *     -> load canonical template (getCanonicalTemplateV127ById)
 *     -> composeTemplateV127   (identity map -> musculoskeletal_limitation -> muscle_priority)
 *     -> validation             (validateFinalWorkoutV127 — v1.27-only, no legacy modifier concept)
 *     -> schedule               (buildWorkoutWeek, shared — pure calendar placement, no v2 coupling)
 *     -> planId/content identity (same stableHash shape as engine.ts, seeded with PRESCRIPTION_VERSIONS_V127)
 *     -> FinalWorkoutPlan
 *
 * `composition.ts`/`modifiers.ts` (the legacy v2 stages) are never imported
 * here — see `compositionV127.ts`'s own file doc for why: population/goal/
 * beginner never reshape a template post-selection in v1.27, so there is
 * structurally nothing for a legacy modifier to do. `safety.ts`,
 * `limitationResolver.ts` (questionnaire -> region ids only, not the
 * catalog-level substitution resolver), `input.ts`, and `weeklySchedule.ts`
 * are pure, answers/session-shape-only utilities already shared by both
 * pipelines before this file existed — reusing them is not "reusing legacy
 * composition/modifiers", it is reusing the same boundary/safety/schedule
 * code both libraries must agree on.
 *
 * NOT wired into `services/workoutPrograms.ts`'s Firestore-backed
 * `prepareWorkoutProgram` (v1.27 templates are not Firestore-seeded — see
 * Fase 9 report §A). Reached only through `generatePrescription.ts`'s
 * central `resolveGenerationVersion` dispatcher, and only when that
 * resolves to `'v1.27'` (test/internal override today).
 */
export function generateWorkoutPrescriptionV127(
  rawAnswers: QuestionnaireAnswers,
  currentTrainingLevel: CurrentTrainingLevel,
  context: PrescriptionGenerationContext = {},
): PrescriptionResult {
  const { answers, legacyReasonCodes } = sanitizeAnswersForEngine(rawAnswers);
  const inputErrors = [...legacyReasonCodes, ...prescriptionInputErrors(answers)];
  if (inputErrors.length) {
    return { status: 'NEEDS_QUESTIONNAIRE_UPDATE', reasonCodes: [...new Set(inputErrors)].sort() };
  }

  const rawSafety = evaluateSafety(answers);
  if (rawSafety.status === 'BLOCKED') {
    return { status: 'BLOCKED', reasonCodes: rawSafety.reasons, safety: rawSafety };
  }
  if (rawSafety.status === 'REQUIRES_CLEARANCE') {
    return { status: 'REQUIRES_CLEARANCE', reasonCodes: rawSafety.reasons, safety: rawSafety };
  }
  // Fase 9 §2 correction — re-scope ADAPTED to only the reason codes v1.27
  // actually backs with a real composition difference (see safetyV127.ts).
  const safety = effectiveSafetyV127(rawSafety);

  const limitationMapping = mapQuestionnaireLimitations(answers);
  if (limitationMapping.status === 'UNMAPPED') {
    return { status: 'INVALID_CONFIGURATION', reasonCodes: limitationMapping.reasonCodes, safety };
  }

  // Fase 7's exact override — `currentTrainingLevel` is the one authority
  // for which level drives selection, never a possibly-stale `answers.level`.
  const effectiveAnswers: QuestionnaireAnswers = {
    ...answers,
    level: questionnaireLevelForCurrentLevel(currentTrainingLevel),
  };
  const derivedInput = selectBaseTemplateV127Input(effectiveAnswers);
  if (derivedInput.status === 'MISSING_INPUT') {
    return { status: 'INVALID_CONFIGURATION', reasonCodes: derivedInput.reasonCodes, safety };
  }
  const selection = selectBaseTemplateV127(derivedInput.input);
  if (selection.status === 'NOT_FOUND') {
    return { status: 'MISSING_TEMPLATE', reasonCodes: [`V127_TEMPLATE_NOT_FOUND:${selection.trace.join('|')}`], safety };
  }

  let template;
  try {
    template = context.template ?? getCanonicalTemplateV127ById(selection.templateId);
  } catch (error) {
    // Fail closed rather than crash: a template whose authored exercises
    // still reference a blocked/unresolved canonical identity (see the
    // identity matrix) must never reach composition.
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'MISSING_TEMPLATE', reasonCodes: [`V127_TEMPLATE_UNAVAILABLE:${message}`], safety };
  }
  if (template.id !== selection.templateId) {
    return {
      status: 'INVALID_CONFIGURATION',
      reasonCodes: [`RUNTIME_TEMPLATE_ID_MISMATCH:${selection.templateId}:${template.id}`],
      safety,
    };
  }

  const composition = composeTemplateV127(template, {
    limitationRegions: limitationMapping.regions,
    musclePriority: answers.muscleFocus,
  });
  const partialTrace = {
    selectionReasons: selection.trace,
    safety,
    appliedModifiers: composition.trace.stagesApplied,
    unresolvedModifiers: [] as string[],
    conflicts: [],
    substitutions: [],
    limitationResolverVersion: 1 as const,
    limitationDecisions: composition.trace.limitationDecisions,
    compositionDecisions: [],
    musclePriorityDecisions: composition.trace.musclePriorityDecisions,
  };
  if (composition.status !== 'COMPOSED') {
    // v1.27 composition has exactly one fail-closed status
    // (`MUSCULOSKELETAL_SUBSTITUTION_UNAVAILABLE`) with no v2 equivalent
    // status name — mapped to `INVALID_CONFIGURATION` (a composition-level
    // "cannot safely proceed under the current rule set", not a catalog
    // lookup miss, which `MISSING_EXERCISE` would misleadingly imply). The
    // real reason codes (`MUSCULOSKELETAL_NO_SUBSTITUTE:<session>:<id>`)
    // are preserved verbatim.
    return {
      status: 'INVALID_CONFIGURATION',
      reasonCodes: composition.reasonCodes,
      safety,
      trace: { ...partialTrace, validationCodes: [] },
    };
  }

  const validationCodes = validateFinalWorkoutV127({ templateId: template.id, sessions: composition.sessions });
  const trace = { ...partialTrace, validationCodes };
  if (validationCodes.length) {
    const missing = validationCodes.filter((code) => code.startsWith('MISSING_EXERCISE:'));
    return {
      status: missing.length ? 'MISSING_EXERCISE' : 'INVALID_CONFIGURATION',
      reasonCodes: validationCodes,
      safety,
      trace,
    };
  }

  const limitationDataset = context.limitationDataset ?? localLimitationDatasetIdentity();
  const scheduleMode = answers.scheduleMode === 'flexible' ? 'flexible' : 'fixed';
  const normalizedAvailableWeekdays = normalizeWeekdays(answers.trainingDays ?? []);
  const structuredDays = trainingSessionIndexes(composition.sessions).length;
  const availability = {
    days: derivedInput.input.availabilityDays,
    weekdays: scheduleMode === 'fixed' && normalizedAvailableWeekdays.length === derivedInput.input.availabilityDays
      ? normalizedAvailableWeekdays
      : [],
  };
  const weeklySchedule = scheduleMode === 'fixed'
    ? buildWorkoutWeek(availability, composition.sessions, structuredDays)
    : [];
  const planIdentity = JSON.stringify({
    templateId: template.id,
    requestedDays: derivedInput.input.availabilityDays,
    prescribedTrainingFrequency: structuredDays,
    scheduleMode,
    availability,
    weeklySchedule,
    limitationDecisions: composition.trace.limitationDecisions,
    musclePriorityDecisions: composition.trace.musclePriorityDecisions,
    limitationDataset: { version: limitationDataset.version, hash: limitationDataset.hash },
    versions: PRESCRIPTION_VERSIONS_V127,
  });
  const plan: FinalWorkoutPlan = {
    planId: `wp_${stableHash(planIdentity)}`,
    templateId: template.id,
    requestedDays: derivedInput.input.availabilityDays,
    prescribedStructuredDays: structuredDays,
    prescribedTrainingFrequency: structuredDays,
    scheduleMode,
    availability,
    weeklySchedule,
    population: derivedInput.input.population,
    environment: derivedInput.input.environment,
    goalFamily: derivedInput.input.goalFamily,
    split: template.split,
    limitationDatasetVersion: limitationDataset.version,
    limitationDatasetHash: limitationDataset.hash,
    sessions: composition.sessions,
    versions: PRESCRIPTION_VERSIONS_V127,
    trace,
  };
  return { status: 'SUCCESS', plan };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
