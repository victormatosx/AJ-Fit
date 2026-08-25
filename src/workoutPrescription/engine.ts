import { catalogInvariantErrors, getTemplateById, TEMPLATE_LIBRARY_VERSION } from './catalog';
import { composeTemplate } from './composition';
import { resolveConflicts } from './conflicts';
import { prescriptionInputErrors } from './input';
import { resolveModifiers } from './modifiers';
import { evaluateSafety } from './safety';
import { selectTemplate } from './selection';
import {
  PRESCRIPTION_VERSIONS,
  type FinalWorkoutPlan,
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

export function generateWorkoutPrescription(answers: QuestionnaireAnswers): PrescriptionResult {
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

  const selection = selectTemplate(answers);
  if (selection.status === 'MISSING_TEMPLATE') {
    return { status: 'MISSING_TEMPLATE', reasonCodes: selection.reasonCodes, safety };
  }
  const template = getTemplateById(selection.decision.templateId);
  if (!template) {
    return { status: 'MISSING_TEMPLATE', reasonCodes: [selection.decision.templateId], safety };
  }

  const modifiers = resolveModifiers(answers, safety);
  const conflicts = resolveConflicts(answers, modifiers);
  const composition = composeTemplate(template, answers);
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
    sessions: composition.sessions,
    versions: PRESCRIPTION_VERSIONS,
    trace,
  };
  return { status: 'SUCCESS', plan };
}
