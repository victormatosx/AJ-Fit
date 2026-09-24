import catalogJson from '../../docs/workouts/AJ_Fit_T001_T090_workouts_reformed_v2_0.json';
import { EXERCISES_SEED } from '../data/exercisesSeedData';
import { CANONICAL_ACTIVITIES } from './canonicalActivities';
import type { CanonicalTemplate, GoalFamily, Population, TemplateEnvironment, TemplateId } from './types';
import { isRecoverySessionType } from './sessionTypes';

function trainingSessionCount(template: CanonicalTemplate): number {
  return template.sessions.filter((session) => !isRecoverySessionType(session.type.toLowerCase())).length;
}

type CatalogShape = {
  schema_version: string;
  library: string;
  workouts: CanonicalTemplate[];
};

const catalog = catalogJson as unknown as CatalogShape;

export const TEMPLATE_LIBRARY_VERSION = catalog.schema_version;
export const TEMPLATE_LIBRARY_ID = catalog.library;
export const WORKOUT_TEMPLATES = catalog.workouts;

const byId = new Map(WORKOUT_TEMPLATES.map((template) => [template.id, template]));

export function getTemplateById(id: TemplateId): CanonicalTemplate | undefined {
  return byId.get(id);
}

export function findTemplate(input: {
  population: Population;
  sex: 'male' | 'female';
  environment: TemplateEnvironment;
  goalFamily: GoalFamily;
  days: number;
}): CanonicalTemplate | undefined {
  return WORKOUT_TEMPLATES.find((template) =>
    (input.population === 'conventional'
      ? template.profile.primary_goal === input.goalFamily && !template.profile.special_population
      : template.profile.special_population === input.population)
    && template.profile.environment === input.environment
    && template.profile.days_per_week === input.days
    && (input.population !== 'conventional' || template.profile.sex === input.sex),
  );
}

/**
 * Phase 2 lookup: frequency means TRAINING sessions, while `days_per_week`
 * remains immutable catalog authoring metadata and may also include a
 * recovery slot (notably frailty 4-day templates).
 */
export function findTemplateForFrequency(input: {
  population: Population;
  sex: 'male' | 'female';
  environment: TemplateEnvironment;
  goalFamily: GoalFamily;
  prescribedTrainingFrequency: number;
  availabilityDays: number;
}): CanonicalTemplate | undefined {
  const candidates = WORKOUT_TEMPLATES.filter((template) =>
    (input.population === 'conventional'
      ? template.profile.primary_goal === input.goalFamily && !template.profile.special_population
      : template.profile.special_population === input.population)
    && template.profile.environment === input.environment
    && (input.population !== 'conventional' || template.profile.sex === input.sex)
    && trainingSessionCount(template) === input.prescribedTrainingFrequency
    && template.sessions.length <= input.availabilityDays,
  );

  return candidates.sort((left, right) => {
    // Exact metadata frequency is the normal path. Frailty can then choose
    // its authored 3 TRAINING + 1 recovery template when a fourth available
    // slot exists, preserving that safety-oriented catalog structure.
    if (input.population === 'frailty') return right.sessions.length - left.sessions.length;
    const leftExact = left.profile.days_per_week === input.prescribedTrainingFrequency ? 0 : 1;
    const rightExact = right.profile.days_per_week === input.prescribedTrainingFrequency ? 0 : 1;
    return leftExact - rightExact || left.sessions.length - right.sessions.length || left.id.localeCompare(right.id);
  })[0];
}

// The published runtime still loads v2.0.0. v1.27.0 is accepted here for the
// future catalog switch; artifact-specific cardinality belongs in its test.
export const SUPPORTED_TEMPLATE_SCHEMA_VERSIONS = ['2.0.0', '1.27.0'] as const;

export function catalogInvariantErrors(source: CatalogShape = catalog): string[] {
  const errors: string[] = [];
  if (!SUPPORTED_TEMPLATE_SCHEMA_VERSIONS.some((version) => version === source.schema_version)) errors.push('UNEXPECTED_TEMPLATE_LIBRARY_VERSION');
  if (!source.workouts.length) errors.push('EMPTY_TEMPLATE_LIBRARY');
  const ids = new Set(source.workouts.map((template) => template.id));
  if (ids.size !== source.workouts.length) errors.push('DUPLICATE_TEMPLATE_ID');
  for (const id of ids) {
    if (!/^T\d{3}$/.test(id) || id === 'T000') errors.push(`INVALID_TEMPLATE_ID:${id}`);
  }
  const exercises = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));
  // Cardio/mobility activities (v1.27) are a disjoint, separately-typed
  // catalog with no `equipment`/muscle metadata — see
  // `canonicalActivities.ts`. Valid `exercise_id` targets, but structurally
  // exempt from the resistance-only equipment/duplicate checks below (an
  // activity `exercise` lookup stays `undefined`, so those checks no-op).
  const activityIds = new Set(CANONICAL_ACTIVITIES.map((activity) => activity.id));
  const homeResistanceEquipment = new Set([
    'bodyweight', 'dumbbell', 'resistance_band', 'mini_band', 'bench', 'chair', 'step', 'slider',
  ]);
  const duplicateSensitiveTypes = new Set(['resistance', 'strength', 'functional_strength']);
  for (const template of source.workouts) {
    if (!template.sessions.length) errors.push(`NO_SESSIONS:${template.id}`);
    for (const [sessionIndex, session] of template.sessions.entries()) {
      const scope = `${template.id}:${sessionIndex}`;
      if (!session.exercises.length) errors.push(`EMPTY_SESSION:${scope}`);
      if (!(session.display_name ?? session.name)?.trim()) errors.push(`MISSING_DISPLAY_NAME:${scope}`);
      const seen = new Set<string>();
      for (const slot of session.exercises) {
        const exercise = exercises.get(slot.exercise_id);
        if (!exercise && !activityIds.has(slot.exercise_id)) errors.push(`INVALID_EXERCISE_ID:${scope}:${slot.exercise_id}`);
        if (slot.sets !== undefined
          && (typeof slot.sets !== 'number' || !Number.isInteger(slot.sets) || slot.sets < 1 || slot.sets > 10)) {
          errors.push(`INVALID_EXERCISE_SETS:${scope}:${slot.exercise_id}`);
        }
        if (slot.cycles !== undefined
          && (typeof slot.cycles !== 'number' || !Number.isInteger(slot.cycles) || slot.cycles < 1 || slot.cycles > 100)) {
          errors.push(`INVALID_EXERCISE_CYCLES:${scope}:${slot.exercise_id}`);
        }
        if (duplicateSensitiveTypes.has(session.type) && seen.has(slot.exercise_id)) {
          errors.push(`DUPLICATE_EXERCISE:${scope}:${slot.exercise_id}`);
        }
        seen.add(slot.exercise_id);
        if (
          template.profile.environment === 'home'
          && duplicateSensitiveTypes.has(session.type)
          && exercise?.equipment.some((item) => !homeResistanceEquipment.has(item))
        ) {
          errors.push(`HOME_EQUIPMENT_INCOMPATIBLE:${scope}:${slot.exercise_id}`);
        }
      }
      const finisher = session.cardio_finisher;
      if (finisher && finisher.mode !== 'integrated') {
        if (!finisher.exercise_options?.length || !finisher.duration || !finisher.intensity) {
          errors.push(`INVALID_CARDIO_FINISHER:${scope}`);
        }
      }
    }
  }
  return errors;
}
