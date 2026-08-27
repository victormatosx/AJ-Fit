import { describe, expect, it, vi } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import {
  CANONICAL_LIMITATION_DATASET_HASH,
  CANONICAL_LIMITATION_PROFILES,
} from '../limitationDataset';
import {
  runLimitationDatasetPublication,
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
