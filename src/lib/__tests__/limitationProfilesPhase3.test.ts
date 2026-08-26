import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import {
  LIMITATION_REGIONS,
  PHASE3_EXTERNAL_PRODUCT_PROFILES,
  buildPhase3V2Profiles,
  convertV3ToProfiles,
  findDirectedCycles,
  validateTechnicalProfiles,
  validateClosedProfileSet,
  type V3Dataset,
} from '../../../scripts/limitationProfilesPhase3';

const v3 = JSON.parse(readFileSync(join(process.cwd(), 'docs/workout-modifiers/exercise-limitations/11_GENERALIZED_CONSERVATIVE_LIMITATION_DATASET_v3.json'), 'utf8')) as V3Dataset;
const profiles = convertV3ToProfiles(v3);
const validation = validateTechnicalProfiles(v3, profiles, new Set(EXERCISES_SEED.map((exercise) => exercise.id)));
const v2Profiles = buildPhase3V2Profiles(profiles);
const v2Validation = validateClosedProfileSet(v2Profiles, new Set(EXERCISES_SEED.map((exercise) => exercise.id)));

describe('Phase 3 limitation profiles', () => {
  it('preserves all 71 x 7 V3 decisions and expected status counts', () => {
    expect(validation.errors).toEqual([]);
    expect(profiles).toHaveLength(71);
    expect(validation.pairCount).toBe(497);
    expect(validation.statusCounts).toEqual({ compatible: 63, adapt: 127, avoid: 110, not_applicable: 197, unknown: 0 });
    expect(profiles.every((entry) => Object.keys(entry.limitationProfile.regions).length === LIMITATION_REGIONS.length)).toBe(true);
  });

  it('emits only concrete catalog variants and explicit avoid gaps', () => {
    expect(validation.adaptCount).toBe(127);
    expect(validation.avoidCount).toBe(110);
    expect(validation.avoidWithoutSubstitute).toHaveLength(110);
    expect(validation.externalCandidateIds).toHaveLength(28);
    expect(validation.externalActionCandidateIds).toHaveLength(5);
  });

  it('keeps product decisions as draft without professional identity', () => {
    for (const entry of profiles) {
      expect(entry.limitationProfile.reviewStatus).toBe('draft');
      expect(entry.limitationProfile).not.toHaveProperty('reviewedBy');
      expect(entry.limitationProfile).not.toHaveProperty('reviewedAt');
    }
  });

  it('detects obvious directed cycles deterministically', () => {
    expect(findDirectedCycles([['a', 'b'], ['b', 'a'], ['c', 'd']])).toHaveLength(1);
    expect(validation.globalCycles).toHaveLength(5);
  });

  it('closes the executable V2 profile set with five external profiles', () => {
    expect(PHASE3_EXTERNAL_PRODUCT_PROFILES.map((entry) => entry.exerciseId).sort()).toEqual([
      'cable-biceps-curl',
      'cable-glute-kickback',
      'iso-lateral-pulldown-machine',
      'lying-leg-raise',
      'machine-lateral-raise',
    ]);
    expect(v2Validation.errors).toEqual([]);
    expect(v2Profiles).toHaveLength(76);
    expect(v2Validation.pairCount).toBe(532);
    expect(v2Validation.statusCounts).toEqual({ compatible: 66, adapt: 138, avoid: 114, not_applicable: 214, unknown: 0 });
    expect(v2Validation.remainingExternalActionCandidateIds).toEqual([]);
  });

  it('does not reinterpret any of the 71 original regional decisions', () => {
    for (const original of profiles) {
      const converted = v2Profiles.find((entry) => entry.exerciseId === original.exerciseId);
      expect(converted).toBeDefined();
      for (const region of LIMITATION_REGIONS) {
        expect(converted?.limitationProfile.regions[region]).toEqual(original.limitationProfile.regions[region]);
      }
    }
  });

  it('marks every V2 profile approved by product policy without fake reviewer data', () => {
    for (const entry of v2Profiles) {
      expect(entry.limitationProfile.reviewStatus).toBe('approved');
      expect(entry.limitationProfile.reviewBasis).toBe('product_policy');
      expect(entry.limitationProfile).not.toHaveProperty('reviewedBy');
      expect(entry.limitationProfile).not.toHaveProperty('reviewedAt');
    }
  });

  it('accepts explicit avoid gaps and reports cycles as data, not validation errors', () => {
    expect(v2Validation.avoidWithoutSubstitute).toHaveLength(114);
    expect(v2Validation.globalCycles).toHaveLength(11);
    expect(v2Validation.valid).toBe(true);
  });
});
