import { normalizeWeekdays } from '../lib/questionnaireSchema';
import { questionnaireLevelForCurrentLevel } from '../workoutLifecycle/prescriptionInputs';
import type { CurrentTrainingLevel } from '../workoutLifecycle/types';
import { getCanonicalTemplateV127ById } from './canonicalCatalog';
import { composeTemplateV127 } from './compositionV127';
import { prescriptionInputErrors,sanitizeAnswersForEngine } from './input';
import { evaluateSafety } from './safety';
import { effectiveSafetyV127 } from './safetyV127';
import { selectBaseTemplateV127,selectBaseTemplateV127Input } from './selectorV127';
import {
  PRESCRIPTION_VERSIONS_V127,
  type FinalWorkoutPlan,
  type PrescriptionGenerationContext,
  type PrescriptionResult,
  type QuestionnaireAnswers,
} from './types';
import { validateFinalWorkoutV127 } from './validationV127';
import { buildWorkoutWeek,trainingSessionIndexes } from './weeklySchedule';

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
    musclePriority: answers.muscleFocus,
  });
  const partialTrace = {
    selectionReasons: selection.trace,
    safety,
    appliedModifiers: composition.trace.stagesApplied,
    unresolvedModifiers: [] as string[],
    conflicts: [],
    substitutions: [],
    compositionDecisions: [],
    musclePriorityDecisions: composition.trace.musclePriorityDecisions,
  };
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
    musclePriorityDecisions: composition.trace.musclePriorityDecisions,
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
