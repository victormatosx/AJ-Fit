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
  /**
   * The full profiles/resolverCatalog snapshot Firestore already persists
   * for `activeIdentity` at `limitationDatasetVersions/{activeIdentity.
   * limitationDatasetHash}` (written by `publishAtomically` itself, every
   * time it seals a new identity) — `null` when there is no active
   * identity, or when no such version document can be found. This is the
   * ONLY evidence `assertActiveHashSafe` accepts to prove a catalog
   * expansion is safe; it is never derived from document counts.
   */
  activeVersionSnapshot: {
    profiles: LimitationProfileEntry[];
    resolverCatalog: LimitationResolverCatalogEntry[];
  } | null;
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
  // Catalog size is no longer pinned to a fixed count (Fase 1 — new valid
  // exercises may be added; every entry below still must resolve to a real
  // id). `entries.length` stays pinned to 95: the clinically/product
  // reviewed profile count after the full v1.27 coverage closure
  // (76 original + 7 + 3 + 2 + 7 — see the phase metadata in the canonical
  // artifact), independent of overall catalog growth. This exact pin keeps
  // accidental additions/removals fail-closed.
  if (!EXERCISES_SEED.length) errors.push('exercise catalog is empty');
  if (catalogIds.size !== EXERCISES_SEED.length) errors.push('duplicate exercise id in canonical catalog');
  if (entries.length !== 95) errors.push(`profile count ${entries.length} != 95`);
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

/**
 * Proves that an active-hash mismatch is a purely additive, safe catalog
 * expansion — never assumed from document counts or any other heuristic.
 * The ONLY evidence accepted is `state.activeVersionSnapshot`, the exact
 * profiles/resolverCatalog Firestore already persisted for the active
 * identity at publish time. Given that snapshot:
 *
 *   1. Every exercise id it lists must still exist in the current remote
 *      catalog (nothing previously published may vanish).
 *   2. Restricting the CURRENT remote profiles/resolverCatalog to exactly
 *      those ids and re-hashing with the SAME canonical scheme
 *      (`sha256LimitationProfiles`/legacy variant) must reproduce the
 *      active hash byte-for-byte — i.e. not one field of any previously
 *      published exercise or profile may have changed.
 *   3. Every id present in the current remote catalog but absent from the
 *      previous snapshot must be a real `EXERCISES_SEED` id — a
 *      recognized, locally-declared exercise, never arbitrary Firestore
 *      drift.
 *
 * Fails closed (throws `LIMITATION_DATASET_ACTIVE_HASH_MISMATCH`) the
 * instant any of this cannot be proven — including when no previous
 * version snapshot is available at all, in which case nothing here is
 * verifiable and the mismatch is treated exactly as before this function
 * existed.
 */
function assertActiveHashSafe(input: {
  activeIdentity: PublishedDatasetIdentity;
  activeVersionSnapshot: PublicationReadState['activeVersionSnapshot'];
  remoteExercises: readonly RemoteExerciseDocument[];
  remote: readonly LimitationProfileEntry[];
  remoteResolverCatalog: readonly LimitationResolverCatalogEntry[];
  localExerciseIds: readonly string[];
}): void {
  const { activeIdentity, activeVersionSnapshot, remoteExercises, remote, remoteResolverCatalog, localExerciseIds } = input;
  if (!activeVersionSnapshot) {
    throw new Error('LIMITATION_DATASET_ACTIVE_HASH_MISMATCH:no_previous_version_snapshot_to_verify_against');
  }
  const previousIds = new Set(activeVersionSnapshot.resolverCatalog.map((entry) => entry.id));
  const currentIds = new Set(remoteExercises.map((exercise) => exercise.id));
  const missingIds = [...previousIds].filter((id) => !currentIds.has(id)).sort();
  if (missingIds.length) {
    throw new Error(`LIMITATION_DATASET_ACTIVE_HASH_MISMATCH:previously_published_exercise_missing:${missingIds.join(',')}`);
  }
  const restrictedProfiles = remote.filter((entry) => previousIds.has(entry.exerciseId));
  const restrictedResolverCatalog = remoteResolverCatalog.filter((entry) => previousIds.has(entry.id));
  const restrictedHash = sha256LimitationProfiles(restrictedProfiles, restrictedResolverCatalog);
  const restrictedLegacyHash = sha256LegacyProfileOnly(restrictedProfiles);
  if (
    restrictedHash !== activeIdentity.limitationDatasetHash
    && restrictedLegacyHash !== activeIdentity.limitationDatasetHash
  ) {
    throw new Error('LIMITATION_DATASET_ACTIVE_HASH_MISMATCH:previously_published_exercise_or_profile_changed');
  }
  const localIds = new Set(localExerciseIds);
  const unrecognizedNewIds = [...currentIds]
    .filter((id) => !previousIds.has(id) && !localIds.has(id))
    .sort();
  if (unrecognizedNewIds.length) {
    throw new Error(`LIMITATION_DATASET_ACTIVE_HASH_MISMATCH:unrecognized_exercise:${unrecognizedNewIds.join(',')}`);
  }
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
    assertActiveHashSafe({
      activeIdentity: state.activeIdentity,
      activeVersionSnapshot: state.activeVersionSnapshot,
      remoteExercises: state.exercises,
      remote,
      remoteResolverCatalog,
      localExerciseIds: exerciseIds,
    });
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
