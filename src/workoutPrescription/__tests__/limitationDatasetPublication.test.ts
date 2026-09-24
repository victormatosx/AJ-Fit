import { describe, expect, it, vi } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import {
  CANONICAL_LIMITATION_DATASET_HASH,
  CANONICAL_LIMITATION_PROFILES,
  type LimitationProfileEntry,
  type LimitationResolverCatalogEntry,
} from '../limitationDataset';
import {
  runLimitationDatasetPublication,
  sha256LimitationProfiles,
  type LimitationDatasetPublicationRepository,
  type PublicationReadState,
} from '../../../scripts/limitationDatasetPublication';

type MutableProfileEntry = { exerciseId: string; limitationProfile: Record<string, any> };

function remoteState(profiles = CANONICAL_LIMITATION_PROFILES): PublicationReadState {
  const byId = new Map(profiles.map((entry) => [entry.exerciseId, entry.limitationProfile]));
  return {
    exercises: EXERCISES_SEED.map((exercise) => ({
      id: exercise.id,
      data: { ...exercise, limitationProfile: byId.get(exercise.id) },
    })),
    activeIdentity: null,
    activeVersionSnapshot: null,
  };
}

function repository(state: PublicationReadState) {
  const publishAtomically = vi.fn<LimitationDatasetPublicationRepository['publishAtomically']>();
  return { readState: vi.fn(async () => state), publishAtomically };
}

describe('limitation dataset publication', () => {
  it('dry-run computes the exact diff and never writes', async () => {
    const remote = structuredClone(CANONICAL_LIMITATION_PROFILES) as MutableProfileEntry[];
    remote.find((entry) => entry.exerciseId === 'dead-bug')!.limitationProfile.regions.knee = { status: 'avoid', substituteExerciseIds: [], candidateStatus: 'missing_exercise_candidate' };
    remote.find((entry) => entry.exerciseId === 'plank')!.limitationProfile.regions.knee.adaptation.exerciseId = 'bird-dog';
    const repo = repository(remoteState(remote));

    const plan = await runLimitationDatasetPublication({ repository: repo });

    expect(plan.mode).toBe('DRY_RUN');
    expect(plan.diffCounts.STATUS_MISMATCH).toBe(1);
    expect(plan.diffCounts.TARGET_MISMATCH).toBe(1);
    expect(plan.divergentCells).toBe(2);
    expect(repo.publishAtomically).not.toHaveBeenCalled();
  });

  it('rejects an invalid canonical fixture before any write', async () => {
    const invalid = structuredClone(CANONICAL_LIMITATION_PROFILES) as MutableProfileEntry[];
    invalid[0].limitationProfile.regions.knee = { status: 'unknown' };
    const repo = repository(remoteState());

    await expect(runLimitationDatasetPublication({
      repository: repo,
      apply: true,
      expectedHash: CANONICAL_LIMITATION_DATASET_HASH,
      canonicalProfiles: invalid,
    })).rejects.toThrow('LIMITATION_DATASET_INVALID');
    expect(repo.readState).not.toHaveBeenCalled();
    expect(repo.publishAtomically).not.toHaveBeenCalled();
  });

  it('requires the exact hash and delegates APPLY as one atomic operation', async () => {
    const repo = repository(remoteState());
    await expect(runLimitationDatasetPublication({
      repository: repo,
      apply: true,
      expectedHash: '0'.repeat(64),
    })).rejects.toThrow('LIMITATION_DATASET_APPLY_HASH_CONFIRMATION_REQUIRED');
    expect(repo.publishAtomically).not.toHaveBeenCalled();

    const plan = await runLimitationDatasetPublication({
      repository: repo,
      apply: true,
      expectedHash: CANONICAL_LIMITATION_DATASET_HASH,
    });
    expect(plan.writeExecuted).toBe(true);
    expect(repo.publishAtomically).toHaveBeenCalledTimes(1);
    expect(repo.publishAtomically).toHaveBeenCalledWith(expect.objectContaining({
      nextIdentity: expect.objectContaining({ limitationDatasetHash: CANONICAL_LIMITATION_DATASET_HASH }),
    }));
  });
});

function catalogEntryFor(exercise: (typeof EXERCISES_SEED)[number]): LimitationResolverCatalogEntry {
  return { ...exercise, id: exercise.id };
}

/**
 * Mirrors the real v1.27 rollout that motivated this fix: a previously
 * published SUBSET of the catalog (its own sealed active hash + the
 * version snapshot Firestore already persists for it) plus a dynamically
 * chosen set of newly-seeded, still-unreviewed exercises with no
 * `limitationProfile` at all — exactly what `seed:exercises` produces
 * before `seed:limitation-profiles` ever touches them. Never hardcodes a
 * catalog size on either side of the split.
 */
function additiveExpansionScenario() {
  const profiledIds = new Set(CANONICAL_LIMITATION_PROFILES.map((entry) => entry.exerciseId));
  const unprofiled = EXERCISES_SEED.filter((exercise) => !profiledIds.has(exercise.id));
  if (unprofiled.length < 3) throw new Error('fixture assumption violated: need >= 3 unprofiled EXERCISES_SEED entries');
  const newExercises = unprofiled.slice(0, 3);
  const newIds = new Set(newExercises.map((exercise) => exercise.id));
  const previousExercises = EXERCISES_SEED.filter((exercise) => !newIds.has(exercise.id));

  const previousResolverCatalog = previousExercises.map(catalogEntryFor);
  const previousProfiles: LimitationProfileEntry[] = CANONICAL_LIMITATION_PROFILES.filter(
    (entry) => !newIds.has(entry.exerciseId),
  );
  const previousHash = sha256LimitationProfiles(previousProfiles, previousResolverCatalog);
  const profileByExerciseId = new Map(previousProfiles.map((entry) => [entry.exerciseId, entry.limitationProfile]));

  const exercises = EXERCISES_SEED.map((exercise) => ({
    id: exercise.id,
    data: { ...exercise, limitationProfile: profileByExerciseId.get(exercise.id) },
  }));

  const state: PublicationReadState = {
    exercises,
    activeIdentity: { datasetVersion: 'v-previous', limitationDatasetHash: previousHash },
    activeVersionSnapshot: { profiles: previousProfiles, resolverCatalog: previousResolverCatalog },
  };
  return { state, previousExercises, newExercises };
}

describe('limitation dataset publication — safe additive catalog expansion (active-hash proof)', () => {
  it('accepts a proven additive expansion (new, unprofiled EXERCISES_SEED exercises) without throwing', async () => {
    const { state } = additiveExpansionScenario();
    const repo = repository(state);

    const plan = await runLimitationDatasetPublication({ repository: repo });

    expect(plan.mode).toBe('DRY_RUN');
    expect(plan.previousIdentity).toEqual(state.activeIdentity);
    expect(plan.identity.limitationDatasetHash).toBe(CANONICAL_LIMITATION_DATASET_HASH);
    expect(Array.isArray(plan.diff)).toBe(true);
    expect(plan.diff.length).toBeGreaterThan(0);
    expect(Array.isArray(plan.changedExerciseIds)).toBe(true);
    expect(Array.isArray(plan.resolverCatalogMismatches)).toBe(true);
    expect(repo.publishAtomically).not.toHaveBeenCalled();
  });

  it("still rejects when a previously published exercise's resolver-catalog fields changed", async () => {
    const { state, previousExercises } = additiveExpansionScenario();
    const mutatedId = previousExercises[0].id;
    const mutated: PublicationReadState = {
      ...state,
      exercises: state.exercises.map((exercise) =>
        exercise.id === mutatedId
          ? { ...exercise, data: { ...exercise.data, equipment: ['__tampered__'] } }
          : exercise),
    };
    const repo = repository(mutated);

    await expect(runLimitationDatasetPublication({ repository: repo }))
      .rejects.toThrow('LIMITATION_DATASET_ACTIVE_HASH_MISMATCH');
    expect(repo.publishAtomically).not.toHaveBeenCalled();
  });

  it("still rejects when a previously published exercise's limitationProfile changed", async () => {
    const { state, previousExercises } = additiveExpansionScenario();
    const profiled = previousExercises.find((exercise) =>
      state.activeVersionSnapshot!.profiles.some((entry) => entry.exerciseId === exercise.id));
    if (!profiled) throw new Error('fixture assumption violated: need a profiled previous exercise');
    const mutated: PublicationReadState = {
      ...state,
      exercises: state.exercises.map((exercise) =>
        exercise.id === profiled.id
          ? {
            ...exercise,
            data: {
              ...exercise.data,
              limitationProfile: {
                schemaVersion: 1, protocolVersion: 'musculoskeletal-v1', reviewStatus: 'approved', regions: {},
              },
            },
          }
          : exercise),
    };
    const repo = repository(mutated);

    await expect(runLimitationDatasetPublication({ repository: repo }))
      .rejects.toThrow('LIMITATION_DATASET_ACTIVE_HASH_MISMATCH');
    expect(repo.publishAtomically).not.toHaveBeenCalled();
  });

  it('rejects an unverifiable active hash (no persisted version snapshot) exactly as before this fix', async () => {
    const { state } = additiveExpansionScenario();
    const unverifiable: PublicationReadState = {
      ...state,
      activeIdentity: { datasetVersion: 'v-unknown', limitationDatasetHash: '1'.repeat(64) },
      activeVersionSnapshot: null,
    };
    const repo = repository(unverifiable);

    await expect(runLimitationDatasetPublication({ repository: repo }))
      .rejects.toThrow('LIMITATION_DATASET_ACTIVE_HASH_MISMATCH');
    expect(repo.publishAtomically).not.toHaveBeenCalled();
  });
});
