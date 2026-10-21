import { questionnaireValidationErrors } from '../lib/questionnaireSchema';
import type { LegacyExperienceLevel,LegacyGoal } from '../state/AppState';
import type { GoalFamily,QuestionnaireAnswers,TemplateEnvironment } from './types';

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
  // `intermediate_experienced` is only a questionnaire self-identification
  // refinement of `intermediate` — prescription logic treats them identically.
  if (level === 'intermediate_experienced') return 'intermediate';
  return LEGACY_LEVEL_MAP[level as LegacyExperienceLevel] ?? level;
}

export function goalFamilyFor(goal: QuestionnaireAnswers['goal']): GoalFamily | null {
  const normalized = normalizeGoal(goal);
  if (normalized === 'strength') return 'strength';
  if (normalized === 'conditioning') return 'conditioning';
  if (['gain_muscle', 'lose_fat', 'health', 'body_composition', 'return_to_training'].includes(normalized ?? '')) {
    return 'hypertrophy_body_composition';
  }
  return null;
}

export function environmentFor(answers: QuestionnaireAnswers): TemplateEnvironment | null {
  if (answers.place === 'gym' || answers.place === 'home') return answers.place;
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
  answers: QuestionnaireAnswers;
  legacyReasonCodes: string[];
}

export function sanitizeAnswersForEngine(
  answers: Partial<QuestionnaireAnswers> | null | undefined,
): SanitizedAnswers {
  const source = (answers ?? {}) as Partial<QuestionnaireAnswers>;
  const { limits: _limits, limitationImpact: _impact, ...activeSource } = source as typeof source & { limits?: unknown; limitationImpact?: unknown };
  const legacyReasonCodes: string[] = [];
  if (!isStringArray(source.specialConditions)) legacyReasonCodes.push('QUESTIONNAIRE_SPECIAL_CONDITIONS_UNKNOWN');
  return {
    answers: {
      ...activeSource,
      specialConditions: isStringArray(source.specialConditions) ? source.specialConditions.filter(value => value !== ('musculoskeletal_limitation' as string)) : [],
      equipment: isStringArray(source.equipment) ? source.equipment : [],
      muscleFocus: isStringArray(source.muscleFocus) ? source.muscleFocus : [],
      style: isStringArray(source.style) ? source.style : [],
    } as QuestionnaireAnswers,
    legacyReasonCodes,
  };
}
