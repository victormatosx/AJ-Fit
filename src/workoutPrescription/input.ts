import type { LegacyExperienceLevel, LegacyGoal } from '../state/AppState';
import { questionnaireValidationErrors } from '../lib/questionnaireSchema';
import type { GoalFamily, QuestionnaireAnswers, TemplateEnvironment } from './types';

const LEGACY_GOAL_MAP: Partial<Record<LegacyGoal, QuestionnaireAnswers['goal']>> = {
  hyper: 'gain_muscle',
  cut: 'lose_fat',
  def: 'body_composition',
  recon: 'return_to_training',
};

const LEGACY_LEVEL_MAP: Record<LegacyExperienceLevel, Exclude<QuestionnaireAnswers['level'], LegacyExperienceLevel | null>> = {
  beg: 'beginner',
  int: 'intermediate',
  adv: 'advanced',
  elite: 'advanced',
};

export function normalizeGoal(goal: QuestionnaireAnswers['goal']): QuestionnaireAnswers['goal'] {
  if (!goal) return null;
  return LEGACY_GOAL_MAP[goal as LegacyGoal] ?? goal;
}

export function normalizeExperience(level: QuestionnaireAnswers['level']): QuestionnaireAnswers['level'] {
  if (!level) return null;
  return LEGACY_LEVEL_MAP[level as LegacyExperienceLevel] ?? level;
}

export function goalFamilyFor(goal: QuestionnaireAnswers['goal']): GoalFamily | null {
  const normalized = normalizeGoal(goal);
  if (normalized === 'strength') return 'strength';
  if (normalized === 'conditioning') return 'conditioning';
  if (['gain_muscle', 'lose_fat', 'body_composition', 'return_to_training'].includes(normalized ?? '')) {
    return 'hypertrophy_body_composition';
  }
  return null;
}

export function environmentFor(answers: QuestionnaireAnswers): TemplateEnvironment | null {
  if (answers.place === 'gym' || answers.place === 'home') return answers.place;
  if (answers.place === 'both') return answers.primaryPlace;
  return null;
}

export function prescriptionInputErrors(answers: QuestionnaireAnswers): string[] {
  const errors = questionnaireValidationErrors(answers).map((error) => `QUESTIONNAIRE_${error.toUpperCase()}`);
  if (!answers.sex) errors.push('QUESTIONNAIRE_SEX_REQUIRED');
  if (!answers.goal) errors.push('QUESTIONNAIRE_GOAL_REQUIRED');
  if (answers.goal === 'perf') errors.push('LEGACY_PERFORMANCE_GOAL_AMBIGUOUS');
  if (!goalFamilyFor(answers.goal)) errors.push('QUESTIONNAIRE_GOAL_UNSUPPORTED');
  if (!answers.level) errors.push('QUESTIONNAIRE_EXPERIENCE_REQUIRED');
  if (!answers.duration) errors.push('QUESTIONNAIRE_DURATION_REQUIRED');
  if (!answers.place) errors.push('QUESTIONNAIRE_ENVIRONMENT_REQUIRED');
  if (answers.lipedemaScreening?.symptomImpact === 'unknown') errors.push('QUESTIONNAIRE_LIPEDEMA_IMPACT_UNKNOWN');
  return [...new Set(errors)].sort();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export interface SanitizedAnswers {
  /** Never has a missing/non-array value on any field the engine indexes with `.includes`/`.filter`/`.length`. */
  answers: QuestionnaireAnswers;
  /**
   * Non-empty ONLY when a field the engine treats as a safety signal
   * (`specialConditions`, `limits`) was missing its array entirely in the
   * source — i.e. the account predates the question being asked at all, not
   * "the user answered none". These codes always force
   * `NEEDS_QUESTIONNAIRE_UPDATE` upstream; `answers` still gets a
   * structurally-safe `[]` for these fields so downstream code never
   * throws, but callers must check `legacyReasonCodes` BEFORE trusting that
   * `[]` as a clinical "no conditions"/"no limitations" answer.
   */
  legacyReasonCodes: string[];
}

/**
 * Single defensive boundary between a persisted/legacy questionnaire shape
 * and the pure engine (`generateWorkoutPrescription`) or the persistence
 * entry point (`generateAndPersistWorkoutProgram`) — both call this FIRST,
 * before touching `answers.specialConditions`/`answers.limits`/etc. Never
 * trusts a caller (onboarding live state, a Firestore round-trip, a forced
 * re-questionnaire) to have already normalized the shape.
 *
 * `specialConditions`/`limits` missing outright (as opposed to an explicit,
 * previously-collected `[]`) means the account was never asked those safety
 * questions — a pre-Safety-phase questionnaire. That must block generation
 * via `legacyReasonCodes`, never silently resolve to "no conditions" just to
 * let a plan generate (see docs/workout-lifecycle — Safety/Limitation
 * Resolver phases). `equipment`/`muscleFocus`/`style` carry no safety
 * meaning — a legacy document missing them safely defaults to `[]` (the
 * questionnaire never collects `equipment` at all — onboarding/steps.ts —
 * so there is no validation requiring it).
 */
export function sanitizeAnswersForEngine(
  answers: Partial<QuestionnaireAnswers> | null | undefined,
): SanitizedAnswers {
  const source = (answers ?? {}) as Partial<QuestionnaireAnswers>;
  const legacyReasonCodes: string[] = [];
  if (!isStringArray(source.specialConditions)) legacyReasonCodes.push('QUESTIONNAIRE_SPECIAL_CONDITIONS_UNKNOWN');
  if (!isStringArray(source.limits)) legacyReasonCodes.push('QUESTIONNAIRE_LIMITS_UNKNOWN');
  return {
    answers: {
      ...source,
      specialConditions: isStringArray(source.specialConditions) ? source.specialConditions : [],
      limits: isStringArray(source.limits) ? source.limits : [],
      equipment: isStringArray(source.equipment) ? source.equipment : [],
      muscleFocus: isStringArray(source.muscleFocus) ? source.muscleFocus : [],
      style: isStringArray(source.style) ? source.style : [],
    } as QuestionnaireAnswers,
    legacyReasonCodes,
  };
}
