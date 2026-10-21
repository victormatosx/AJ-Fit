import { normalizeWeekdays } from '../lib/questionnaireSchema';
import { TEMPLATE_LIBRARY_VERSION,catalogInvariantErrors,getTemplateById } from './catalog';
import { composeTemplate } from './composition';
import { resolveConflicts } from './conflicts';
import { prescriptionInputErrors,sanitizeAnswersForEngine } from './input';
import { resolveModifiers } from './modifiers';
import { adaptationStage,isBeginnerExperience } from './personalization';
import { evaluateSafety } from './safety';
import { selectTemplate } from './selection';
import {
  PRESCRIPTION_VERSIONS,
  type FinalWorkoutPlan,
  type PrescriptionGenerationContext,
  type PrescriptionResult,
  type QuestionnaireAnswers,
} from './types';
import { validateFinalWorkout } from './validation';
import { buildWorkoutWeek } from './weeklySchedule';

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function generateWorkoutPrescription(
  rawAnswers: QuestionnaireAnswers,
  context: PrescriptionGenerationContext = {},
): PrescriptionResult {
  // Boundary first: never index a possibly-legacy/malformed shape before
  // this. See `sanitizeAnswersForEngine`'s doc comment — `legacyReasonCodes`
  // is never merged into a "safe" default, it always blocks generation.
  const { answers, legacyReasonCodes } = sanitizeAnswersForEngine(rawAnswers);
  const inputErrors = [...legacyReasonCodes, ...prescriptionInputErrors(answers)];
  if (inputErrors.length) {
    return { status: 'NEEDS_QUESTIONNAIRE_UPDATE', reasonCodes: [...new Set(inputErrors)].sort() };
  }

  const catalogErrors = catalogInvariantErrors();
  if (TEMPLATE_LIBRARY_VERSION !== PRESCRIPTION_VERSIONS.templateLibrary) {
    catalogErrors.push('ENGINE_TEMPLATE_LIBRARY_VERSION_MISMATCH');
  }
  if (catalogErrors.length) {
    return { status: 'INVALID_CONFIGURATION', reasonCodes: [...new Set(catalogErrors)].sort() };
  }

  const safety = evaluateSafety(answers);
  if (safety.status === 'BLOCKED') {
    return { status: 'BLOCKED', reasonCodes: safety.reasons, safety };
  }
  if (safety.status === 'REQUIRES_CLEARANCE') {
    return { status: 'REQUIRES_CLEARANCE', reasonCodes: safety.reasons, safety };
  }

  const selection = selectTemplate(answers);
  if (selection.status === 'MISSING_TEMPLATE') {
    return { status: 'MISSING_TEMPLATE', reasonCodes: selection.reasonCodes, safety };
  }
  const template = context.template ?? getTemplateById(selection.decision.templateId);
  if (!template) {
    return { status: 'MISSING_TEMPLATE', reasonCodes: [selection.decision.templateId], safety };
  }
  if (template.id !== selection.decision.templateId) {
    return {
      status: 'INVALID_CONFIGURATION',
      reasonCodes: [`RUNTIME_TEMPLATE_ID_MISMATCH:${selection.decision.templateId}:${template.id}`],
      safety,
    };
  }

  const planAdaptationStage = isBeginnerExperience(answers)
    ? adaptationStage(context.adaptationWeek)
    : undefined;
  const modifiers = resolveModifiers(answers, safety, planAdaptationStage);
  const conflicts = resolveConflicts(answers, modifiers);
  const composition = composeTemplate(template, answers, {
    adaptationWeek: planAdaptationStage,
    safety,
    environment: selection.decision.environment,
    exerciseCatalog: context.exerciseCatalog,
  });
  const partialTrace = {
    selectionReasons: selection.decision.reasons,
    safety,
    appliedModifiers: modifiers
      .filter((modifier) => modifier.application !== 'RULE_DEFINITION_REQUIRED')
      .map((modifier) => modifier.id),
    unresolvedModifiers: modifiers
      .filter((modifier) => modifier.application === 'RULE_DEFINITION_REQUIRED')
      .map((modifier) => modifier.id),
    conflicts,
    substitutions: composition.substitutions,
    compositionDecisions: composition.decisions,
  };
  if (composition.status !== 'COMPOSED') {
    return {
      status: composition.status,
      reasonCodes: composition.reasonCodes,
      safety,
      trace: partialTrace,
    };
  }

  const validationCodes = validateFinalWorkout({
    selection: selection.decision,
    sessions: composition.sessions,
    modifiers,
  });
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

  const scheduleMode = answers.scheduleMode === 'flexible' ? 'flexible' : 'fixed';
  const normalizedAvailableWeekdays = normalizeWeekdays(answers.trainingDays ?? []);
  const availability = {
    days: selection.decision.requestedDays,
    // Missing/incomplete concrete weekdays are a legacy setup state, not
    // permission to invent or silently narrow availability.
    weekdays: scheduleMode === 'fixed' && normalizedAvailableWeekdays.length === selection.decision.requestedDays
      ? normalizedAvailableWeekdays
      : [],
  };
  const weeklySchedule = scheduleMode === 'fixed'
    ? buildWorkoutWeek(availability, composition.sessions, selection.decision.prescribedStructuredDays)
    : [];
  const planIdentity = JSON.stringify({
    templateId: selection.decision.templateId,
    requestedDays: selection.decision.requestedDays,
    prescribedTrainingFrequency: selection.decision.prescribedStructuredDays,
    scheduleMode,
    availability,
    weeklySchedule,
    modifiers: modifiers.map((modifier) => modifier.id),
    substitutions: composition.substitutions,
    compositionDecisions: composition.decisions,
    adaptationStage: planAdaptationStage,
    versions: PRESCRIPTION_VERSIONS,
  });
  const plan: FinalWorkoutPlan = {
    planId: `wp_${stableHash(planIdentity)}`,
    templateId: selection.decision.templateId,
    requestedDays: selection.decision.requestedDays,
    prescribedStructuredDays: selection.decision.prescribedStructuredDays,
    prescribedTrainingFrequency: selection.decision.prescribedStructuredDays,
    scheduleMode,
    availability,
    weeklySchedule,
    population: selection.decision.population,
    environment: selection.decision.environment,
    goalFamily: selection.decision.goalFamily,
    split: template.split,
    adaptationStage: planAdaptationStage,
    sessions: composition.sessions,
    versions: PRESCRIPTION_VERSIONS,
    trace,
  };
  return { status: 'SUCCESS', plan };
}
