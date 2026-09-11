import { EXERCISES_SEED } from '../data/exercisesSeedData';
import type { LimitationCatalog, LimitationCatalogExercise } from './limitationResolver';

/**
 * Shared client catalog for every Manual Substitution consumer. Keeping one
 * exported catalog prevents execution materialization, candidate previews,
 * and Meu Plano's effective view from drifting onto different datasets.
 */
export const MANUAL_SUBSTITUTION_CATALOG: LimitationCatalog = new Map<string, LimitationCatalogExercise>(
  EXERCISES_SEED.map((exercise) => [exercise.id, exercise]),
);
