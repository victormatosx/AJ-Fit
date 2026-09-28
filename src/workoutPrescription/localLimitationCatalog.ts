import { EXERCISES_SEED } from '../data/exercisesSeedData';
import type { LimitationCatalogExercise } from './limitationResolver';
import {
  CANONICAL_LIMITATION_DATASET_VERSION,
  CANONICAL_LIMITATION_PROFILES,
  localLimitationDatasetIdentity,
  type LimitationDatasetSnapshot,
} from './limitationDataset';

/**
 * Local, bundled equivalent of `loadExerciseCatalogForLimitations`
 * (`src/services/workoutPrograms.ts`, which reads the Firestore `exercises`
 * collection) — used ONLY by the pre-auth compute path
 * (`prepareWorkoutProgramLocally`, Phase 3).
 *
 * WHY this exists: `firestore.rules` requires
 * `hasVerifiedEmailForPrivateAccess()` to read `exercises` — a client with
 * no Firebase user yet (mid-onboarding, before `signUp()`) cannot perform
 * that read at all. `EXERCISES_SEED` (bundled, used everywhere else in the
 * engine already) has every field `LimitationCatalogExercise` needs EXCEPT
 * `limitationProfile` — that lives only in Firestore (per-exercise document
 * field) and in this same bundled, versioned technical dataset (the exact
 * source `scripts/seedExerciseLimitationProfiles.ts` uses to seed
 * Firestore in the first place, and what
 * `src/workoutPrescription/__tests__/fixtures.ts`'s
 * `realLimitationCatalogFixture()` already merges in for tests — same
 * merge, now available to production runtime code, not just tests).
 *
 * Post-auth persistence/reconciliation keep using the Firestore-backed
 * version unchanged — Firestore remains authoritative after signup. A
 * questionnaire that triggered the Limitation Resolver during pre-auth
 * compute is deliberately NEVER trusted for direct persistence at signup
 * (see `persistPreparedWorkoutProgram`'s doc comment) — this local catalog
 * only has to be correct enough to give the Analysis screen a real,
 * non-bypassed Limitation Resolver run and an accurate preview; the
 * authoritative Firestore-backed recomputation is always what actually
 * gets persisted for that case.
 */
export const LIMITATION_PROFILES_DATASET_VERSION = CANONICAL_LIMITATION_DATASET_VERSION;

type LimitationProfilesFile = {
  profiles: Array<{ exerciseId: string; limitationProfile: unknown }>;
};

const profileByExerciseId = new Map(
  (CANONICAL_LIMITATION_PROFILES as LimitationProfilesFile['profiles']).map(
    (entry) => [entry.exerciseId, entry.limitationProfile],
  ),
);

/**
 * Synchronous, pure, no I/O — mirrors `loadExerciseCatalogForLimitations`'s
 * semantic identity checks. New valid exercises may be added to the seed;
 * every authored limitation profile must still resolve to a seeded ID.
 */
export function loadLocalExerciseCatalogForLimitations(): LimitationCatalogExercise[] {
  if (!EXERCISES_SEED.length) throw new Error('LIMITATION_CATALOG_EMPTY');
  const ids = new Set(EXERCISES_SEED.map((exercise) => exercise.id));
  if (ids.size !== EXERCISES_SEED.length) throw new Error('LIMITATION_CATALOG_DUPLICATE_ID');
  for (const id of profileByExerciseId.keys()) {
    if (!ids.has(id)) throw new Error(`LIMITATION_PROFILE_EXERCISE_MISSING:${id}`);
  }
  return EXERCISES_SEED.map((exercise) => ({
    ...exercise,
    limitationProfile: profileByExerciseId.get(exercise.id),
  }));
}

export function loadLocalLimitationDataset(): LimitationDatasetSnapshot {
  return {
    ...localLimitationDatasetIdentity(),
    exercises: loadLocalExerciseCatalogForLimitations(),
  };
}
