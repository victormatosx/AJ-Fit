import { EXERCISES_SEED } from '../data/exercisesSeedData';
import type { ExerciseCatalog } from './exerciseCatalog';

export const MANUAL_SUBSTITUTION_CATALOG: ExerciseCatalog = new Map(EXERCISES_SEED.map(exercise => [exercise.id, exercise]));
