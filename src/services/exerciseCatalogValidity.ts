import { EXERCISES_SEED } from '../data/exercisesSeedData';
import type { LimitationCatalogExercise } from '../workoutPrescription/limitationResolver';

export function isExerciseCatalogDocument(value: unknown, id: string): value is LimitationCatalogExercise {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LimitationCatalogExercise>;
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
  if (!documents.length) errors.push('LIMITATION_CATALOG_EMPTY');
  const ids = new Set<string>();
  for (const document of documents) {
    if (ids.has(document.id)) errors.push(`LIMITATION_CATALOG_DUPLICATE_ID:${document.id}`);
    ids.add(document.id);
    if (!isExerciseCatalogDocument(document.data, document.id)) {
      errors.push(`LIMITATION_CATALOG_EXERCISE_INVALID:${document.id}`);
    }
  }
  // The local seed owns the baseline IDs; additional valid Firestore exercises
  // are allowed after their limitation dataset identity is published.
  for (const exercise of EXERCISES_SEED) {
    if (!ids.has(exercise.id)) errors.push(`LIMITATION_CATALOG_REQUIRED_EXERCISE_MISSING:${exercise.id}`);
  }
  return errors;
}
