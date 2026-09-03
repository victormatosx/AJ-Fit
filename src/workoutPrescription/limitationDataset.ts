import limitationDatasetJson from '../../docs/workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json';
import limitationDatasetIdentityJson from '../../docs/workout-modifiers/exercise-limitations/limitation-dataset-identity.json';
import { EXERCISES_SEED } from '../data/exercisesSeedData';
import { LIMITATION_REGION_IDS, type LimitationRegionId } from '../types/exercise';
import type { LimitationCatalogExercise } from './limitationResolver';

export const LIMITATION_DATASET_STATE_COLLECTION = 'limitationDatasetState';
export const LIMITATION_DATASET_ACTIVE_DOCUMENT = 'active';
export const LIMITATION_DATASET_VERSIONS_COLLECTION = 'limitationDatasetVersions';

export type LimitationDatasetSource = 'local' | 'firestore';

export interface LimitationDatasetIdentity {
  version: string;
  hash: string;
  source: LimitationDatasetSource;
}

export interface LimitationProfileEntry {
  exerciseId: string;
  limitationProfile: unknown;
}

export interface LimitationResolverCatalogEntry {
  id: string;
  status?: unknown;
  difficulty?: unknown;
  equipment?: unknown;
  target?: unknown;
  movement?: unknown;
  bodyPosition?: unknown;
  availability?: unknown;
  substitution?: unknown;
}

export interface LimitationDatasetSnapshot extends LimitationDatasetIdentity {
  exercises: LimitationCatalogExercise[];
}

type CanonicalDatasetArtifact = {
  datasetVersion: string;
  profiles: LimitationProfileEntry[];
};

const artifact = limitationDatasetJson as unknown as CanonicalDatasetArtifact;
const identityArtifact = limitationDatasetIdentityJson as {
  datasetVersion: string;
  limitationDatasetHash: string;
  algorithm: 'sha256';
};

export const CANONICAL_LIMITATION_DATASET_VERSION = artifact.datasetVersion;
export const CANONICAL_LIMITATION_DATASET_HASH = identityArtifact.limitationDatasetHash;
export const CANONICAL_LIMITATION_PROFILES = artifact.profiles;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalRule(value: unknown): unknown {
  if (!isRecord(value) || typeof value.status !== 'string') return value;
  if (value.status === 'adapt') {
    const adaptation = isRecord(value.adaptation) ? value.adaptation : {};
    return {
      status: value.status,
      adaptation: {
        kind: adaptation.kind,
        exerciseId: adaptation.exerciseId,
      },
    };
  }
  if (value.status === 'avoid') {
    return {
      status: value.status,
      substituteExerciseIds: Array.isArray(value.substituteExerciseIds)
        ? [...value.substituteExerciseIds]
        : [],
      candidateStatus: value.candidateStatus,
    };
  }
  return { status: value.status };
}

/**
 * Stable clinical representation used for SHA-256 identity. Object insertion
 * order, dataset generation timestamps, and profile array order never affect
 * it. Candidate list order is preserved because it is a clinical preference.
 */
function canonicalProfileRows(entries: readonly LimitationProfileEntry[]) {
  return [...entries]
    .sort((left, right) => left.exerciseId.localeCompare(right.exerciseId))
    .map((entry) => {
      const profile = isRecord(entry.limitationProfile) ? entry.limitationProfile : {};
      const regions = isRecord(profile.regions) ? profile.regions : {};
      return {
        exerciseId: entry.exerciseId,
        profile: {
          schemaVersion: profile.schemaVersion,
          protocolVersion: profile.protocolVersion,
          reviewStatus: profile.reviewStatus,
          reviewBasis: profile.reviewBasis ?? null,
          reviewedBy: profile.reviewedBy ?? null,
          regions: LIMITATION_REGION_IDS.map((region) => ({
            region,
            rule: canonicalRule(regions[region]),
          })),
        },
      };
    });
}

function sortedStrings(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value].sort() : [];
}

function canonicalResolverCatalog(entries: readonly LimitationResolverCatalogEntry[]) {
  return [...entries].sort((left, right) => left.id.localeCompare(right.id)).map((entry) => {
    const target = isRecord(entry.target) ? entry.target : {};
    const movement = isRecord(entry.movement) ? entry.movement : {};
    const availability = isRecord(entry.availability) ? entry.availability : {};
    const substitution = isRecord(entry.substitution) ? entry.substitution : {};
    return {
      exerciseId: entry.id,
      status: entry.status,
      difficulty: entry.difficulty,
      equipment: sortedStrings(entry.equipment),
      target: {
        primaryMuscle: target.primaryMuscle,
        secondaryMuscles: sortedStrings(target.secondaryMuscles),
      },
      movement: {
        pattern: movement.pattern,
        mechanic: movement.mechanic,
        laterality: movement.laterality,
      },
      bodyPosition: entry.bodyPosition,
      availability: {
        workoutGeneration: availability.workoutGeneration,
        manualSelection: availability.manualSelection,
        substitution: availability.substitution,
      },
      substitution: {
        group: substitution.group ?? null,
        // Candidate order is semantically relevant to deterministic ranking.
        similarExerciseIds: Array.isArray(substitution.similarExerciseIds)
          ? [...substitution.similarExerciseIds]
          : [],
        limitationVariantIds: Array.isArray(substitution.limitationVariantIds)
          ? [...substitution.limitationVariantIds]
          : [],
      },
    };
  });
}

/** Complete deterministic identity of every input that can affect limitation resolution. */
export function canonicalizeLimitationProfiles(
  entries: readonly LimitationProfileEntry[],
  resolverCatalog: readonly LimitationResolverCatalogEntry[] = EXERCISES_SEED,
): string {
  return JSON.stringify({
    resolverCatalog: canonicalResolverCatalog(resolverCatalog),
    profiles: canonicalProfileRows(entries),
  });
}

/** Compatibility check for the profile-only hash published before resolver catalog identity existed. */
export function canonicalizeLegacyProfileOnlyDataset(entries: readonly LimitationProfileEntry[]): string {
  return JSON.stringify(canonicalProfileRows(entries));
}

export type LimitationDatasetDiffKind =
  | 'LOCAL_ONLY'
  | 'REMOTE_ONLY'
  | 'STATUS_MISMATCH'
  | 'TARGET_MISMATCH'
  | 'METADATA_MISMATCH'
  | 'EXACT_MATCH';

export interface LimitationDatasetCellDiff {
  exerciseId: string;
  region: LimitationRegionId;
  kind: LimitationDatasetDiffKind;
  localRule: unknown;
  remoteRule: unknown;
}

function ruleTarget(rule: unknown): unknown {
  if (!isRecord(rule)) return null;
  if (rule.status === 'adapt') {
    return isRecord(rule.adaptation) ? rule.adaptation.exerciseId ?? null : null;
  }
  if (rule.status === 'avoid') {
    return {
      substituteExerciseIds: Array.isArray(rule.substituteExerciseIds)
        ? rule.substituteExerciseIds
        : [],
      candidateStatus: rule.candidateStatus ?? null,
    };
  }
  return null;
}

function profileMetadata(profile: unknown): unknown {
  if (!isRecord(profile)) return null;
  return {
    schemaVersion: profile.schemaVersion,
    protocolVersion: profile.protocolVersion,
    reviewStatus: profile.reviewStatus,
    reviewBasis: profile.reviewBasis ?? null,
    reviewedBy: profile.reviewedBy ?? null,
  };
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Full deterministic 116-exercise × 7-region semantic diff. */
export function diffLimitationProfiles(input: {
  exerciseIds: readonly string[];
  local: readonly LimitationProfileEntry[];
  remote: readonly LimitationProfileEntry[];
}): LimitationDatasetCellDiff[] {
  const local = new Map(input.local.map((entry) => [entry.exerciseId, entry.limitationProfile]));
  const remote = new Map(input.remote.map((entry) => [entry.exerciseId, entry.limitationProfile]));
  return [...new Set(input.exerciseIds)].sort().flatMap((exerciseId) =>
    LIMITATION_REGION_IDS.map((region): LimitationDatasetCellDiff => {
      const localProfile = local.get(exerciseId);
      const remoteProfile = remote.get(exerciseId);
      const localRegions = isRecord(localProfile) && isRecord(localProfile.regions) ? localProfile.regions : {};
      const remoteRegions = isRecord(remoteProfile) && isRecord(remoteProfile.regions) ? remoteProfile.regions : {};
      const localRule = localRegions[region];
      const remoteRule = remoteRegions[region];
      let kind: LimitationDatasetDiffKind;
      if (localRule != null && remoteRule == null) kind = 'LOCAL_ONLY';
      else if (localRule == null && remoteRule != null) kind = 'REMOTE_ONLY';
      else if (!isRecord(localRule) || !isRecord(remoteRule)) kind = deepEqual(localRule, remoteRule) ? 'EXACT_MATCH' : 'METADATA_MISMATCH';
      else if (localRule.status !== remoteRule.status) kind = 'STATUS_MISMATCH';
      else if (!deepEqual(ruleTarget(localRule), ruleTarget(remoteRule))) kind = 'TARGET_MISMATCH';
      else if (!deepEqual(canonicalRule(localRule), canonicalRule(remoteRule))
        || !deepEqual(profileMetadata(localProfile), profileMetadata(remoteProfile))) kind = 'METADATA_MISMATCH';
      else kind = 'EXACT_MATCH';
      return { exerciseId, region, kind, localRule: localRule ?? null, remoteRule: remoteRule ?? null };
    }),
  );
}

export function limitationDatasetDiffCounts(
  diff: readonly LimitationDatasetCellDiff[],
): Record<LimitationDatasetDiffKind, number> {
  const counts: Record<LimitationDatasetDiffKind, number> = {
    LOCAL_ONLY: 0,
    REMOTE_ONLY: 0,
    STATUS_MISMATCH: 0,
    TARGET_MISMATCH: 0,
    METADATA_MISMATCH: 0,
    EXACT_MATCH: 0,
  };
  for (const cell of diff) counts[cell.kind] += 1;
  return counts;
}

export function localLimitationDatasetIdentity(): LimitationDatasetIdentity {
  if (identityArtifact.datasetVersion !== CANONICAL_LIMITATION_DATASET_VERSION) {
    throw new Error('LOCAL_LIMITATION_DATASET_IDENTITY_VERSION_MISMATCH');
  }
  if (!/^[a-f0-9]{64}$/.test(CANONICAL_LIMITATION_DATASET_HASH)) {
    throw new Error('LOCAL_LIMITATION_DATASET_HASH_INVALID');
  }
  return {
    version: CANONICAL_LIMITATION_DATASET_VERSION,
    hash: CANONICAL_LIMITATION_DATASET_HASH,
    source: 'local',
  };
}
