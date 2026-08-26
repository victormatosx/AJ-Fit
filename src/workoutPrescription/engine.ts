import { catalogInvariantErrors, getTemplateById, TEMPLATE_LIBRARY_VERSION } from './catalog';
import { composeTemplate } from './composition';
import { resolveConflicts } from './conflicts';
import { prescriptionInputErrors } from './input';
import { resolveModifiers } from './modifiers';
import { evaluateSafety } from './safety';
import { selectTemplate } from './selection';
import { adaptationStage, isBeginnerExperience } from './personalization';
import { LIMITATION_RESOLVER_VERSION, mapQuestionnaireLimitations } from './limitationResolver';
import {
  PRESCRIPTION_VERSIONS,
  type FinalWorkoutPlan,
  type PrescriptionGenerationContext,
  type PrescriptionResult,
  type QuestionnaireAnswers,
} from './types';
import { validateFinalWorkout } from './validation';

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function generateWorkoutPrescription(
  answers: QuestionnaireAnswers,
  context: PrescriptionGenerationContext = {},
): PrescriptionResult {
  const inputErrors = prescriptionInputErrors(answers);
  if (inputErrors.length) {
    return { status: 'NEEDS_QUESTIONNAIRE_UPDATE', reasonCodes: inputErrors };
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

  const limitationMapping = mapQuestionnaireLimitations(answers);
  if (limitationMapping.status === 'UNMAPPED') {
    return { status: 'INVALID_CONFIGURATION', reasonCodes: limitationMapping.reasonCodes, safety };
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
    limitationRegions: limitationMapping.regions,
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
    limitationResolverVersion: LIMITATION_RESOLVER_VERSION,
    limitationDecisions: composition.limitationDecisions,
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

  const planIdentity = JSON.stringify({
    templateId: selection.decision.templateId,
    requestedDays: selection.decision.requestedDays,
    modifiers: modifiers.map((modifier) => modifier.id),
    substitutions: composition.substitutions,
    limitationDecisions: composition.limitationDecisions,
    compositionDecisions: composition.decisions,
    adaptationStage: planAdaptationStage,
    versions: PRESCRIPTION_VERSIONS,
  });
  const plan: FinalWorkoutPlan = {
    planId: `wp_${stableHash(planIdentity)}`,
    templateId: selection.decision.templateId,
    requestedDays: selection.decision.requestedDays,
    prescribedStructuredDays: selection.decision.prescribedStructuredDays,
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
