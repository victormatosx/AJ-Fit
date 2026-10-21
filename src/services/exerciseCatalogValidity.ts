import { EXERCISES_SEED } from '../data/exercisesSeedData';
import type { CatalogExercise } from '../workoutPrescription/exerciseCatalog';

export function isExerciseCatalogDocument(value: unknown, id: string): value is CatalogExercise {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CatalogExercise>;
  return item.slug === id
    && ['active', 'inactive', 'draft'].includes(item.status ?? '')
    && Array.isArray(item.equipment)
    && item.target != null
    && typeof item.target.primaryMuscle === 'string'
    && item.movement != null
    && typeof item.movement.pattern === 'string'
    && item.availability != null
    && item.substitution != null
    && Array.isArray(item.substitution.similarExerciseIds);
}

export function exerciseCatalogErrors(documents: readonly { id: string; data: unknown }[]): string[] {
  const errors: string[] = [];
  if (!documents.length) errors.push('EXERCISE_CATALOG_EMPTY');
  const ids = new Set<string>();
  for (const document of documents) {
    if (ids.has(document.id)) errors.push(`EXERCISE_CATALOG_DUPLICATE_ID:${document.id}`);
    ids.add(document.id);
    if (!isExerciseCatalogDocument(document.data, document.id)) {
      errors.push(`EXERCISE_CATALOG_EXERCISE_INVALID:${document.id}`);
    }
  }
  // The local seed owns the baseline IDs; additional valid Firestore exercises
  // are allowed when they satisfy the ordinary catalog contract.
  for (const exercise of EXERCISES_SEED) {
    if (!ids.has(exercise.id)) errors.push(`EXERCISE_CATALOG_REQUIRED_EXERCISE_MISSING:${exercise.id}`);
  }
  return errors;
}
