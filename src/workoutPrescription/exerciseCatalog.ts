import type { ExerciseSeedInput } from '../types/exercise';

export type CatalogExercise = ExerciseSeedInput;
export type ExerciseCatalog = ReadonlyMap<string, CatalogExercise>;
