import catalogJson from '../../docs/workouts/AJ_Fit_T001_T090_workouts_canonical_v1_3.json';
import type { CanonicalTemplate, GoalFamily, Population, TemplateEnvironment, TemplateId } from './types';

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

export function catalogInvariantErrors(): string[] {
  const errors: string[] = [];
  if (TEMPLATE_LIBRARY_VERSION !== '1.3.0') errors.push('UNEXPECTED_TEMPLATE_LIBRARY_VERSION');
  if (WORKOUT_TEMPLATES.length !== 90) errors.push('EXPECTED_90_TEMPLATES');
  const ids = new Set(WORKOUT_TEMPLATES.map((template) => template.id));
  for (let index = 1; index <= 90; index += 1) {
    const id = `T${String(index).padStart(3, '0')}` as TemplateId;
    if (!ids.has(id)) errors.push(`MISSING_${id}`);
  }
  for (const id of ids) {
    if (!/^T(?:00[1-9]|0[1-8][0-9]|090)$/.test(id)) errors.push(`OUT_OF_RANGE_${id}`);
  }
  return errors;
}
