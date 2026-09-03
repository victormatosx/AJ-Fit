import { createHash } from 'node:crypto';

import { EXERCISES_SEED } from '../src/data/exercisesSeedData';
import {
  CANONICAL_LIMITATION_DATASET_VERSION,
  CANONICAL_LIMITATION_DATASET_HASH,
  CANONICAL_LIMITATION_PROFILES,
  canonicalizeLegacyProfileOnlyDataset,
  canonicalizeLimitationProfiles,
  diffLimitationProfiles,
  limitationDatasetDiffCounts,
  type LimitationDatasetCellDiff,
  type LimitationProfileEntry,
  type LimitationResolverCatalogEntry,
} from '../src/workoutPrescription/limitationDataset';
import { validateLimitationProfile } from '../src/workoutPrescription/limitationResolver';

export interface PublishedDatasetIdentity {
  datasetVersion: string;
  limitationDatasetHash: string;
}

export interface RemoteExerciseDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface PublicationReadState {
  exercises: RemoteExerciseDocument[];
  activeIdentity: PublishedDatasetIdentity | null;
}

export interface AtomicPublicationInput {
  expectedRemoteHash: string;
  expectedActiveHash: string | null;
  previousIdentity: PublishedDatasetIdentity;
  previousProfiles: LimitationProfileEntry[];
  previousResolverCatalog: LimitationResolverCatalogEntry[];
  nextIdentity: PublishedDatasetIdentity;
  nextProfiles: LimitationProfileEntry[];
  nextResolverCatalog: LimitationResolverCatalogEntry[];
}

export interface LimitationDatasetPublicationRepository {
  readState(): Promise<PublicationReadState>;
  publishAtomically(input: AtomicPublicationInput): Promise<void>;
}

export interface PublicationPlan {
  mode: 'DRY_RUN' | 'APPLY';
  identity: PublishedDatasetIdentity;
  previousIdentity: PublishedDatasetIdentity;
  exerciseDocumentCount: number;
  canonicalProfileCount: number;
  remoteProfileCount: number;
  diffCounts: ReturnType<typeof limitationDatasetDiffCounts>;
  divergentCells: number;
  divergentExercises: number;
  changedExerciseIds: string[];
  resolverCatalogMismatches: Array<{ exerciseId: string; fields: string[] }>;
  diff: LimitationDatasetCellDiff[];
  writeExecuted: boolean;
}

export function sha256LimitationProfiles(
  entries: readonly LimitationProfileEntry[],
  resolverCatalog: readonly LimitationResolverCatalogEntry[] = EXERCISES_SEED,
): string {
  return createHash('sha256').update(canonicalizeLimitationProfiles(entries, resolverCatalog)).digest('hex');
}

function sha256LegacyProfileOnly(entries: readonly LimitationProfileEntry[]): string {
  return createHash('sha256').update(canonicalizeLegacyProfileOnlyDataset(entries)).digest('hex');
}

const RESOLVER_FIELDS = [
  'status', 'difficulty', 'equipment', 'target', 'movement',
  'bodyPosition', 'availability', 'substitution',
] as const;

function resolverCatalogMismatches(
  remote: readonly RemoteExerciseDocument[],
): Array<{ exerciseId: string; fields: string[] }> {
  const remoteById = new Map(remote.map((entry) => [entry.id, entry.data]));
  return EXERCISES_SEED.flatMap((exercise) => {
    const remoteExercise = remoteById.get(exercise.id);
    const fields = RESOLVER_FIELDS.filter((field) =>
      JSON.stringify(exercise[field] ?? null) !== JSON.stringify(remoteExercise?.[field] ?? null));
    return fields.length ? [{ exerciseId: exercise.id, fields: [...fields] }] : [];
  });
}

export function validateCanonicalLimitationDataset(
  entries: readonly LimitationProfileEntry[] = CANONICAL_LIMITATION_PROFILES,
): void {
  const errors: string[] = [];
  const catalogIds = new Set(EXERCISES_SEED.map((exercise) => exercise.id));
  if (EXERCISES_SEED.length !== 116) errors.push(`exercise catalog count ${EXERCISES_SEED.length} != 116`);
  if (entries.length !== 76) errors.push(`profile count ${entries.length} != 76`);
  if (new Set(entries.map((entry) => entry.exerciseId)).size !== entries.length) {
    errors.push('duplicate exerciseId in canonical profiles');
  }
  for (const entry of entries) {
    if (!catalogIds.has(entry.exerciseId)) errors.push(`${entry.exerciseId}: exercise missing from canonical catalog`);
    const validation = validateLimitationProfile(entry.exerciseId, entry.limitationProfile);
    if (!validation.valid) errors.push(`${entry.exerciseId}: ${validation.reasonCode}`);
  }
  if (errors.length) throw new Error(`LIMITATION_DATASET_INVALID:\n${errors.sort().join('\n')}`);
}

function remoteProfiles(exercises: readonly RemoteExerciseDocument[]): LimitationProfileEntry[] {
  return exercises
    .filter((exercise) => exercise.data.limitationProfile != null)
    .map((exercise) => ({ exerciseId: exercise.id, limitationProfile: exercise.data.limitationProfile }));
}

export async function runLimitationDatasetPublication(input: {
  repository: LimitationDatasetPublicationRepository;
  apply?: boolean;
  expectedHash?: string;
  canonicalProfiles?: readonly LimitationProfileEntry[];
  datasetVersion?: string;
}): Promise<PublicationPlan> {
  const profiles = [...(input.canonicalProfiles ?? CANONICAL_LIMITATION_PROFILES)];
  const datasetVersion = input.datasetVersion ?? CANONICAL_LIMITATION_DATASET_VERSION;
  validateCanonicalLimitationDataset(profiles);
  const identity = {
    datasetVersion,
    limitationDatasetHash: sha256LimitationProfiles(profiles),
  };
  if (!input.canonicalProfiles && identity.limitationDatasetHash !== CANONICAL_LIMITATION_DATASET_HASH) {
    throw new Error('LIMITATION_DATASET_IDENTITY_ARTIFACT_MISMATCH');
  }
  if (input.apply && input.expectedHash !== identity.limitationDatasetHash) {
    throw new Error('LIMITATION_DATASET_APPLY_HASH_CONFIRMATION_REQUIRED');
  }

  const state = await input.repository.readState();
  const exerciseIds = EXERCISES_SEED.map((exercise) => exercise.id);
  if (state.exercises.length !== exerciseIds.length) {
    throw new Error(`LIMITATION_CATALOG_COUNT_INVALID:${state.exercises.length}`);
  }
  const remote = remoteProfiles(state.exercises);
  const diff = diffLimitationProfiles({ exerciseIds, local: profiles, remote });
  const diffCounts = limitationDatasetDiffCounts(diff);
  const divergent = diff.filter((cell) => cell.kind !== 'EXACT_MATCH');
  const remoteResolverCatalog = state.exercises.map((exercise) => ({ id: exercise.id, ...exercise.data }));
  const remoteHash = sha256LimitationProfiles(remote, remoteResolverCatalog);
  const legacyRemoteHash = sha256LegacyProfileOnly(remote);
  if (
    state.activeIdentity
    && state.activeIdentity.limitationDatasetHash !== remoteHash
    && state.activeIdentity.limitationDatasetHash !== legacyRemoteHash
  ) {
    throw new Error('LIMITATION_DATASET_ACTIVE_HASH_MISMATCH');
  }
  const previousIdentity = state.activeIdentity ?? {
    datasetVersion: 'legacy-unversioned',
    limitationDatasetHash: remoteHash,
  };
  const catalogMismatches = resolverCatalogMismatches(state.exercises);
  const changedExerciseIds = [...new Set([
    ...divergent.map((cell) => cell.exerciseId),
    ...catalogMismatches.map((item) => item.exerciseId),
  ])].sort();
  const plan: PublicationPlan = {
    mode: input.apply ? 'APPLY' : 'DRY_RUN',
    identity,
    previousIdentity,
    exerciseDocumentCount: state.exercises.length,
    canonicalProfileCount: profiles.length,
    remoteProfileCount: remote.length,
    diffCounts,
    divergentCells: divergent.length,
    divergentExercises: new Set(divergent.map((cell) => cell.exerciseId)).size,
    changedExerciseIds,
    resolverCatalogMismatches: catalogMismatches,
    diff,
    writeExecuted: false,
  };

  if (!input.apply) return plan;
  await input.repository.publishAtomically({
    expectedRemoteHash: remoteHash,
    expectedActiveHash: state.activeIdentity?.limitationDatasetHash ?? null,
    previousIdentity,
    previousProfiles: remote,
    previousResolverCatalog: remoteResolverCatalog,
    nextIdentity: identity,
    nextProfiles: profiles,
    nextResolverCatalog: EXERCISES_SEED,
  });
  return { ...plan, writeExecuted: true };
}
