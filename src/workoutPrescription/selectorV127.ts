import canonicalJson from '../../docs/workouts/AJ_Fit_T001_T102_workouts_canonical_v1_27_goal_routing_fixed.json';
import { questionnaireLevelForCurrentLevel } from '../workoutLifecycle/prescriptionInputs';
import type { CurrentTrainingLevel } from '../workoutLifecycle/types';
import { environmentFor, goalFamilyFor } from './input';
import { isBeginnerExperience } from './personalization';
import { populationFor } from './selection';
import type { GoalFamily, Population, QuestionnaireAnswers, TemplateEnvironment, TemplateId } from './types';

/**
 * Phase 3 — pure base-template selector for the future v1.27.0 library.
 * NOT wired into the production runtime (see catalog.ts, which still loads
 * v2.0.0). Selection only: it never touches sets, reps, rest, exercises,
 * cardio, duration, equipment or limitations — those remain modifiers that
 * run downstream of template selection.
 */

export interface TemplateProfileV127 {
  id: TemplateId;
  sex: 'male' | 'female' | 'any';
  environment: TemplateEnvironment;
  primary_goal: string;
  days_per_week: number;
  special_population?: Exclude<Population, 'conventional'>;
  experience_level?: 'beginner';
}

type RawCanonicalV127 = { workouts: { id: TemplateId; profile: TemplateProfileV127 }[] };

/**
 * Profile metadata only — deliberately bypasses exercise resolution
 * (`canonicalCatalog.parseCanonicalV127Template`) so a still-blocked
 * exercise identity (see the identity matrix) can never prevent template
 * *selection*, which has no dependency on exercise content.
 */
export const V127_TEMPLATE_PROFILES: readonly TemplateProfileV127[] =
  (canonicalJson as unknown as RawCanonicalV127).workouts.map((workout) => ({ ...workout.profile, id: workout.id }));

const SPECIAL_POPULATION_GOAL: Record<Exclude<Population, 'conventional'>, string> = {
  pregnancy: 'pregnancy_fitness',
  postpartum: 'postpartum_return',
  frailty: 'frailty_function',
};

export interface SelectBaseTemplateV127Input {
  sex: 'male' | 'female';
  environment: TemplateEnvironment;
  goalFamily: GoalFamily;
  population: Population;
  isBeginner: boolean;
  /** Raw availability, clamped to [2, 7]. Never a prescribed/capped frequency. */
  availabilityDays: number;
}

export type SelectBaseTemplateV127Result =
  | { status: 'SELECTED'; templateId: TemplateId; trace: string[] }
  | { status: 'NOT_FOUND'; trace: string[] };

function clampAvailability(days: number): number {
  return Math.max(2, Math.min(7, Math.trunc(days)));
}

/**
 * Effective template days per the Fase 3 frequency table. Special
 * populations cap at 4 (2->2, 3->3, 4-7->4) with no separate frailty-only
 * cap — the legacy `frequency.ts` 3-day frailty cap does not apply here.
 * Conventional and beginner routes use availability directly, uncapped by
 * experience level.
 */
function effectiveTemplateDays(population: Population, availabilityDays: number): number {
  return population === 'conventional' ? availabilityDays : Math.min(availabilityDays, 4);
}

export function selectBaseTemplateV127(
  input: SelectBaseTemplateV127Input,
  catalog: readonly TemplateProfileV127[] = V127_TEMPLATE_PROFILES,
): SelectBaseTemplateV127Result {
  const availabilityDays = clampAvailability(input.availabilityDays);
  const trace: string[] = [];

  if (input.population !== 'conventional') {
    const effectiveDays = effectiveTemplateDays(input.population, availabilityDays);
    trace.push(
      `population_route:${input.population}`,
      `environment:${input.environment}`,
      `effective_days:${effectiveDays}`,
    );
    const goal = SPECIAL_POPULATION_GOAL[input.population];
    const match = catalog.find((template) =>
      template.special_population === input.population
      && template.primary_goal === goal
      && template.environment === input.environment
      && template.days_per_week === effectiveDays);
    trace.push(`template_id:${match?.id ?? 'NONE'}`);
    return match ? { status: 'SELECTED', templateId: match.id, trace } : { status: 'NOT_FOUND', trace };
  }

  if (input.isBeginner) {
    trace.push(
      'population_route:conventional',
      'beginner_route:true',
      `environment:${input.environment}`,
      `effective_days:${availabilityDays}`,
    );
    const match = catalog.find((template) =>
      template.experience_level === 'beginner'
      && template.environment === input.environment
      && template.days_per_week === availabilityDays);
    trace.push(`template_id:${match?.id ?? 'NONE'}`);
    return match ? { status: 'SELECTED', templateId: match.id, trace } : { status: 'NOT_FOUND', trace };
  }

  trace.push(
    'population_route:conventional',
    'beginner_route:false',
    `goal_family:${input.goalFamily}`,
    `sex:${input.sex}`,
    `environment:${input.environment}`,
    `effective_days:${availabilityDays}`,
  );
  const match = catalog.find((template) =>
    !template.special_population
    && !template.experience_level
    && template.primary_goal === input.goalFamily
    && template.sex === input.sex
    && template.environment === input.environment
    && template.days_per_week === availabilityDays);
  trace.push(`template_id:${match?.id ?? 'NONE'}`);
  return match ? { status: 'SELECTED', templateId: match.id, trace } : { status: 'NOT_FOUND', trace };
}

export type SelectBaseTemplateV127InputResult =
  | { status: 'READY'; input: SelectBaseTemplateV127Input }
  | { status: 'MISSING_INPUT'; reasonCodes: string[] };

/**
 * Questionnaire adapter. Reuses the same pure dimension derivation as the
 * active v2.0 selector (`selection.ts`, `input.ts`, `personalization.ts`) —
 * one source of truth for population/goal-family/environment/beginner
 * classification, not a second parallel implementation.
 */
export function selectBaseTemplateV127Input(answers: QuestionnaireAnswers): SelectBaseTemplateV127InputResult {
  const population = populationFor(answers);
  const environment = environmentFor(answers);
  const goalFamily = goalFamilyFor(answers.goal);
  const reasonCodes: string[] = [];
  if (!answers.sex) reasonCodes.push('SEX_MISSING');
  if (!environment) reasonCodes.push('ENVIRONMENT_MISSING');
  if (!goalFamily) reasonCodes.push('GOAL_FAMILY_UNRECOGNIZED');
  if (!answers.days || ![2, 3, 4, 5, 6, 7].includes(answers.days)) reasonCodes.push('AVAILABILITY_DAYS_INVALID');
  if (reasonCodes.length) return { status: 'MISSING_INPUT', reasonCodes };
  return {
    status: 'READY',
    input: {
      sex: answers.sex === 'm' ? 'male' : 'female',
      environment: environment as TemplateEnvironment,
      goalFamily: goalFamily as GoalFamily,
      population,
      isBeginner: isBeginnerExperience(answers),
      availabilityDays: answers.days as number,
    },
  };
}

export function selectBaseTemplateV127FromAnswers(
  answers: QuestionnaireAnswers,
  catalog: readonly TemplateProfileV127[] = V127_TEMPLATE_PROFILES,
): SelectBaseTemplateV127Result | { status: 'MISSING_INPUT'; reasonCodes: string[] } {
  const derived = selectBaseTemplateV127Input(answers);
  if (derived.status === 'MISSING_INPUT') return derived;
  return selectBaseTemplateV127(derived.input, catalog);
}

/**
 * Fase 7 — the v1.27 integration point for the existing Progression Engine
 * V2 / Workout Lifecycle authority. `currentTrainingLevel`
 * (`WorkoutLifecycle.currentTrainingLevel`, docs workout-lifecycle/v2) is
 * the ONE authoritative source for which level drives selection after a
 * promotion — never the raw, possibly-stale `answers.level` a user's
 * original questionnaire response might still carry. This mirrors exactly
 * how the existing v2 path already resolves it: the client's
 * `effectivePrescriptionInputsFromAnswers` and the backend's
 * `authorizeMutation.ts` (`currentLevelInput`) both override `level` from
 * `currentTrainingLevel` before either engine ever sees the answers, so a
 * BEGINNER→INTERMEDIATE promotion can never silently regenerate back into
 * T091-T102 just because the stored questionnaire document was never
 * re-answered. This function applies that exact same, single override
 * (`questionnaireLevelForCurrentLevel`, imported — not reimplemented) to
 * the v1.27 selector. Still not called by `engine.ts`/any production path —
 * see this file's top-of-file "not wired into the production runtime" doc.
 */
export function selectBaseTemplateV127ForCurrentTrainingLevel(
  answers: QuestionnaireAnswers,
  currentTrainingLevel: CurrentTrainingLevel,
  catalog: readonly TemplateProfileV127[] = V127_TEMPLATE_PROFILES,
): SelectBaseTemplateV127Result | { status: 'MISSING_INPUT'; reasonCodes: string[] } {
  const effectiveAnswers: QuestionnaireAnswers = {
    ...answers,
    level: questionnaireLevelForCurrentLevel(currentTrainingLevel),
  };
  return selectBaseTemplateV127FromAnswers(effectiveAnswers, catalog);
}
