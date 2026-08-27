#!/usr/bin/env -S node --import tsx
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';

import { EXERCISES_SEED } from '../src/data/exercisesSeedData';
import {
  LIMITATION_DATASET_ACTIVE_DOCUMENT,
  LIMITATION_DATASET_STATE_COLLECTION,
  LIMITATION_DATASET_VERSIONS_COLLECTION,
  diffLimitationProfiles,
  limitationDatasetDiffCounts,
  type LimitationProfileEntry,
} from '../src/workoutPrescription/limitationDataset';
import {
  runLimitationDatasetPublication,
  sha256LimitationProfiles,
  type AtomicPublicationInput,
  type LimitationDatasetPublicationRepository,
  type PublicationReadState,
  type PublishedDatasetIdentity,
} from './limitationDatasetPublication';

const ROOT = process.cwd();
const DIFF_ARTIFACT = join(ROOT, 'docs/workout-modifiers/limitation-dataset-firestore-diff.json');
const RESULT_ARTIFACT = join(ROOT, 'docs/workout-modifiers/limitation-dataset-publication-result.json');
const BACKUP_DIR = join(ROOT, 'docs/workout-modifiers/limitation-publication-backups');

function projectId(): string {
  const config = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8')) as {
    projects?: { production?: string };
  };
  if (!config.projects?.production) throw new Error('projects.production ausente em .firebaserc');
  return config.projects.production;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const hashIndex = argv.indexOf('--expected-hash');
  return { apply, expectedHash: hashIndex >= 0 ? argv[hashIndex + 1] : undefined };
}

function identityFrom(value: Record<string, unknown> | undefined): PublishedDatasetIdentity | null {
  if (
    typeof value?.datasetVersion !== 'string'
    || typeof value.limitationDatasetHash !== 'string'
  ) return null;
  return {
    datasetVersion: value.datasetVersion,
    limitationDatasetHash: value.limitationDatasetHash,
  };
}

class FirestorePublicationRepository implements LimitationDatasetPublicationRepository {
  lastPublication: AtomicPublicationInput | null = null;

  constructor(private readonly db: Firestore) {}

  async readState(): Promise<PublicationReadState> {
    const [exercises, active] = await Promise.all([
      this.db.collection('exercises').get(),
      this.db.collection(LIMITATION_DATASET_STATE_COLLECTION)
        .doc(LIMITATION_DATASET_ACTIVE_DOCUMENT).get(),
    ]);
    return {
      exercises: exercises.docs.map((document) => ({ id: document.id, data: document.data() })),
      activeIdentity: active.exists ? identityFrom(active.data()) : null,
    };
  }

  private async transact(input: AtomicPublicationInput): Promise<void> {
    const exerciseRefs = EXERCISES_SEED.map((exercise) =>
      this.db.collection('exercises').doc(exercise.id));
    const activeRef = this.db.collection(LIMITATION_DATASET_STATE_COLLECTION)
      .doc(LIMITATION_DATASET_ACTIVE_DOCUMENT);
    const previousVersionRef = this.db.collection(LIMITATION_DATASET_VERSIONS_COLLECTION)
      .doc(input.previousIdentity.limitationDatasetHash);
    const nextVersionRef = this.db.collection(LIMITATION_DATASET_VERSIONS_COLLECTION)
      .doc(input.nextIdentity.limitationDatasetHash);

    await this.db.runTransaction(async (transaction) => {
      const [exerciseSnapshots, activeSnapshot, previousVersion, nextVersion] = await Promise.all([
        transaction.getAll(...exerciseRefs),
        transaction.get(activeRef),
        transaction.get(previousVersionRef),
        transaction.get(nextVersionRef),
      ]);
      const currentProfiles = exerciseSnapshots
        .filter((snapshot) => snapshot.data()?.limitationProfile != null)
        .map((snapshot) => ({
          exerciseId: snapshot.id,
          limitationProfile: snapshot.data()!.limitationProfile,
        }));
      const currentResolverCatalog = exerciseSnapshots.map((snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }));
      if (sha256LimitationProfiles(currentProfiles, currentResolverCatalog) !== input.expectedRemoteHash) {
        throw new Error('LIMITATION_DATASET_CHANGED_AFTER_DRY_RUN');
      }
      const activeIdentity = activeSnapshot.exists ? identityFrom(activeSnapshot.data()) : null;
      if (activeIdentity?.limitationDatasetHash !== input.expectedActiveHash) {
        throw new Error('LIMITATION_DATASET_ACTIVE_CHANGED_AFTER_DRY_RUN');
      }

      const versionBody = (
        identity: PublishedDatasetIdentity,
        profiles: LimitationProfileEntry[],
        resolverCatalog: AtomicPublicationInput['nextResolverCatalog'],
      ) => ({
        ...identity,
        profileCount: profiles.length,
        regionCount: 7,
        pairCount: profiles.length * 7,
        profiles,
        resolverCatalog,
        createdAt: FieldValue.serverTimestamp(),
      });
      if (
        input.previousIdentity.limitationDatasetHash !== input.nextIdentity.limitationDatasetHash
        && !previousVersion.exists
      ) {
        transaction.create(previousVersionRef, versionBody(
          input.previousIdentity,
          input.previousProfiles,
          input.previousResolverCatalog,
        ));
      }
      if (!nextVersion.exists) {
        transaction.create(nextVersionRef, versionBody(
          input.nextIdentity,
          input.nextProfiles,
          input.nextResolverCatalog,
        ));
      }
      const nextById = new Map(input.nextProfiles.map((entry) => [entry.exerciseId, entry.limitationProfile]));
      const nextCatalogById = new Map(input.nextResolverCatalog.map((entry) => [entry.id, entry]));
      for (const ref of exerciseRefs) {
        const profile = nextById.get(ref.id);
        const catalog = nextCatalogById.get(ref.id);
        if (!catalog) throw new Error(`LIMITATION_RESOLVER_CATALOG_EXERCISE_MISSING:${ref.id}`);
        transaction.update(ref, {
          limitationProfile: profile ?? FieldValue.delete(),
          status: catalog.status,
          difficulty: catalog.difficulty,
          equipment: catalog.equipment,
          target: catalog.target,
          movement: catalog.movement,
          bodyPosition: catalog.bodyPosition ?? FieldValue.delete(),
          availability: catalog.availability,
          substitution: catalog.substitution,
        });
      }
      transaction.set(activeRef, {
        ...input.nextIdentity,
        profileCount: input.nextProfiles.length,
        regionCount: 7,
        pairCount: input.nextProfiles.length * 7,
        previousDatasetHash: input.previousIdentity.limitationDatasetHash,
        publishedAt: FieldValue.serverTimestamp(),
      });
    });
  }

  async publishAtomically(input: AtomicPublicationInput): Promise<void> {
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(
      join(BACKUP_DIR, `${input.previousIdentity.limitationDatasetHash}.json`),
      `${JSON.stringify({
        identity: input.previousIdentity,
        profiles: input.previousProfiles,
        resolverCatalog: input.previousResolverCatalog,
      }, null, 2)}\n`,
      'utf8',
    );
    this.lastPublication = input;
    await this.transact(input);
  }

  async rollbackLastPublication(): Promise<void> {
    if (!this.lastPublication) throw new Error('LIMITATION_DATASET_ROLLBACK_SNAPSHOT_MISSING');
    const input = this.lastPublication;
    await this.transact({
      expectedRemoteHash: input.nextIdentity.limitationDatasetHash,
      expectedActiveHash: input.nextIdentity.limitationDatasetHash,
      previousIdentity: input.nextIdentity,
      previousProfiles: input.nextProfiles,
      previousResolverCatalog: input.nextResolverCatalog,
      nextIdentity: input.previousIdentity,
      nextProfiles: input.previousProfiles,
      nextResolverCatalog: input.previousResolverCatalog,
    });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targetProject = projectId();
  if (!getApps().length) {
    initializeApp({ credential: applicationDefault(), projectId: targetProject });
  }
  const repository = new FirestorePublicationRepository(getFirestore());
  const plan = await runLimitationDatasetPublication({
    repository,
    apply: args.apply,
    expectedHash: args.expectedHash,
  });
  writeFileSync(DIFF_ARTIFACT, `${JSON.stringify({
    projectId: targetProject,
    ...plan,
  }, null, 2)}\n`, 'utf8');
  if (args.apply) {
    const archive = join(
      ROOT,
      'docs/workout-modifiers',
      `limitation-dataset-firestore-diff-${plan.previousIdentity.limitationDatasetHash}-to-${plan.identity.limitationDatasetHash}.json`,
    );
    writeFileSync(archive, `${JSON.stringify({ projectId: targetProject, ...plan }, null, 2)}\n`, 'utf8');
  }

  if (!args.apply) {
    console.log(JSON.stringify({
      mode: plan.mode,
      projectId: targetProject,
      identity: plan.identity,
      previousIdentity: plan.previousIdentity,
      exerciseDocumentCount: plan.exerciseDocumentCount,
      canonicalProfileCount: plan.canonicalProfileCount,
      remoteProfileCount: plan.remoteProfileCount,
      diffCounts: plan.diffCounts,
      divergentCells: plan.divergentCells,
      divergentExercises: plan.divergentExercises,
      changedExerciseIds: plan.changedExerciseIds,
      resolverCatalogMismatches: plan.resolverCatalogMismatches,
      writeExecuted: false,
      artifact: DIFF_ARTIFACT,
    }, null, 2));
    return;
  }

  try {
    const after = await repository.readState();
    const afterProfiles = after.exercises
      .filter((exercise) => exercise.data.limitationProfile != null)
      .map((exercise) => ({ exerciseId: exercise.id, limitationProfile: exercise.data.limitationProfile }));
    const afterDiff = diffLimitationProfiles({
      exerciseIds: EXERCISES_SEED.map((exercise) => exercise.id),
      local: repository.lastPublication!.nextProfiles,
      remote: afterProfiles,
    });
    const afterCounts = limitationDatasetDiffCounts(afterDiff);
    const valid = after.activeIdentity?.limitationDatasetHash === plan.identity.limitationDatasetHash
      && sha256LimitationProfiles(
        afterProfiles,
        after.exercises.map((exercise) => ({ id: exercise.id, ...exercise.data })),
      ) === plan.identity.limitationDatasetHash
      && afterDiff.every((cell) => cell.kind === 'EXACT_MATCH');
    if (!valid) throw new Error('LIMITATION_DATASET_POST_PUBLICATION_VERIFICATION_FAILED');
    const result = {
      publishedAt: new Date().toISOString(),
      projectId: targetProject,
      identity: plan.identity,
      previousIdentity: plan.previousIdentity,
      atomicWrite: true,
      changedExerciseIds: plan.changedExerciseIds,
      prePublishDivergentCells: plan.divergentCells,
      prePublishResolverCatalogMismatches: plan.resolverCatalogMismatches,
      postPublishDiffCounts: afterCounts,
      remoteHashVerified: true,
      rollbackExecuted: false,
    };
    writeFileSync(RESULT_ARTIFACT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    writeFileSync(
      join(ROOT, 'docs/workout-modifiers', `limitation-dataset-publication-result-${plan.identity.limitationDatasetHash}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify({ ...result, artifact: RESULT_ARTIFACT }, null, 2));
  } catch (error) {
    await repository.rollbackLastPublication();
    throw new Error(`PUBLICATION_VERIFICATION_FAILED_AND_ROLLED_BACK:${
      error instanceof Error ? error.message : String(error)}`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
