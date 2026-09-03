import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import identityArtifact from '../../../docs/workout-modifiers/exercise-limitations/limitation-dataset-identity.json';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import {
  CANONICAL_LIMITATION_DATASET_HASH,
  CANONICAL_LIMITATION_DATASET_VERSION,
  CANONICAL_LIMITATION_PROFILES,
  canonicalizeLimitationProfiles,
} from '../limitationDataset';

function hash(entries: typeof CANONICAL_LIMITATION_PROFILES): string {
  return createHash('sha256').update(canonicalizeLimitationProfiles(entries)).digest('hex');
}

type MutableProfileEntry = { exerciseId: string; limitationProfile: Record<string, any> };

function cloneProfiles(): MutableProfileEntry[] {
  return structuredClone(CANONICAL_LIMITATION_PROFILES) as MutableProfileEntry[];
}

describe('limitation dataset identity', () => {
  it('canonicalizes deterministically regardless of profile and object key order', () => {
    const reordered = cloneProfiles().reverse().map((entry) => ({
      limitationProfile: Object.fromEntries(Object.entries(entry.limitationProfile).reverse()),
      exerciseId: entry.exerciseId,
    }));
    expect(canonicalizeLimitationProfiles(reordered)).toBe(
      canonicalizeLimitationProfiles(CANONICAL_LIMITATION_PROFILES),
    );
    expect(hash(reordered)).toBe(hash(CANONICAL_LIMITATION_PROFILES));
  });

  it('keeps the checked-in version/hash artifact exact', () => {
    expect(identityArtifact.datasetVersion).toBe(CANONICAL_LIMITATION_DATASET_VERSION);
    expect(identityArtifact.limitationDatasetHash).toBe(CANONICAL_LIMITATION_DATASET_HASH);
    expect(hash(CANONICAL_LIMITATION_PROFILES)).toBe(CANONICAL_LIMITATION_DATASET_HASH);
  });

  it('changes the hash when a status changes', () => {
    const changed = cloneProfiles();
    changed[0].limitationProfile.regions.knee = { status: 'compatible' };
    expect(hash(changed)).not.toBe(CANONICAL_LIMITATION_DATASET_HASH);
  });

  it('changes the hash when an adaptation target changes', () => {
    const changed = cloneProfiles();
    const plank = changed.find((entry) => entry.exerciseId === 'plank');
    if (!plank) throw new Error('plank profile missing');
    plank.limitationProfile.regions.knee = {
      status: 'adapt',
      adaptation: { kind: 'exercise_variant', exerciseId: 'bird-dog' },
    };
    expect(hash(changed)).not.toBe(CANONICAL_LIMITATION_DATASET_HASH);
  });

  it('changes the hash when resolver candidate metadata changes', () => {
    const catalog = structuredClone(EXERCISES_SEED);
    catalog.find((exercise) => exercise.id === 'conventional-deadlift')!
      .substitution.limitationVariantIds = [];
    const changedHash = createHash('sha256')
      .update(canonicalizeLimitationProfiles(CANONICAL_LIMITATION_PROFILES, catalog))
      .digest('hex');
    expect(changedHash).not.toBe(CANONICAL_LIMITATION_DATASET_HASH);
  });
});
