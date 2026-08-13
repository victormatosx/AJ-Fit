import { createHash } from 'node:crypto';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import {
  isConfirmedCandidate,
  isOldEnough,
  ORPHAN_MIN_AGE_MS,
  parsePhotoObjectPath,
} from './orphanPolicy';

const SCOPE = 'photoVault.cleanupOrphans';
const MARKERS = '_photoVaultCleanupCandidates';
const STORAGE_PAGE_SIZE = 250;
const MAX_METADATA_PER_RUN = 500;

type CandidateKind = 'storage-without-firestore' | 'firestore-without-storage';

interface Marker {
  kind: CandidateKind;
  storagePath: string;
  fingerprint: string;
  firstSeenAt: Timestamp;
}

export interface CleanupStats {
  scannedObjects: number;
  scannedDocuments: number;
  marked: number;
  preserved: number;
  deletedObjects: number;
  deletedDocuments: number;
  failed: number;
}

function emptyStats(): CleanupStats {
  return {
    scannedObjects: 0,
    scannedDocuments: 0,
    marked: 0,
    preserved: 0,
    deletedObjects: 0,
    deletedDocuments: 0,
    failed: 0,
  };
}

function markerId(kind: CandidateKind, storagePath: string): string {
  return createHash('sha256').update(`${kind}:${storagePath}`).digest('hex');
}

function markerRef(kind: CandidateKind, storagePath: string) {
  return db.collection(MARKERS).doc(markerId(kind, storagePath));
}

async function clearMarker(kind: CandidateKind, storagePath: string): Promise<void> {
  await markerRef(kind, storagePath).delete().catch(() => undefined);
}

async function confirmOrMark(params: {
  kind: CandidateKind;
  storagePath: string;
  fingerprint: string;
  nowMillis: number;
}): Promise<'marked' | 'waiting' | 'confirmed'> {
  const ref = markerRef(params.kind, params.storagePath);
  const snapshot = await ref.get();
  const marker = snapshot.data() as Partial<Marker> | undefined;

  if (
    !marker ||
    marker.kind !== params.kind ||
    marker.storagePath !== params.storagePath ||
    marker.fingerprint !== params.fingerprint ||
    !(marker.firstSeenAt instanceof Timestamp)
  ) {
    await ref.set({
      kind: params.kind,
      storagePath: params.storagePath,
      fingerprint: params.fingerprint,
      firstSeenAt: FieldValue.serverTimestamp(),
    });
    return 'marked';
  }

  return isConfirmedCandidate(marker.firstSeenAt.toMillis(), params.nowMillis)
    ? 'confirmed'
    : 'waiting';
}

async function reconcileStorageObjects(
  nowMillis: number,
  stats: CleanupStats,
): Promise<void> {
  const bucket = getStorage().bucket();
  let pageToken: string | undefined;

  do {
    // Disable the client library's implicit auto-pagination so one large
    // bucket never materializes every object in the Function's memory.
    const [files, nextQuery] = await bucket.getFiles({
      prefix: 'users/',
      autoPaginate: false,
      maxResults: STORAGE_PAGE_SIZE,
      pageToken,
    });

    for (const file of files) {
      const parsed = parsePhotoObjectPath(file.name);
      if (!parsed) continue;
      stats.scannedObjects += 1;

      try {
        const [metadata] = await file.getMetadata();
        const createdAtMillis = Date.parse(metadata.timeCreated ?? '');
        if (!isOldEnough(createdAtMillis, nowMillis)) {
          stats.preserved += 1;
          continue;
        }

        const document = db.doc(
          `users/${parsed.uid}/progressPhotos/${parsed.photoId}`,
        );
        const documentSnapshot = await document.get();
        const documentData = documentSnapshot.data() as
          | { storagePath?: unknown; thumbnailStoragePath?: unknown }
          | undefined;
        const linked =
          documentSnapshot.exists &&
          (parsed.assetKind === 'full'
            ? documentData?.storagePath === file.name
            : documentData?.thumbnailStoragePath === file.name);
        if (linked) {
          await clearMarker('storage-without-firestore', file.name);
          stats.preserved += 1;
          continue;
        }

        const generation = String(metadata.generation ?? '');
        if (!generation) throw new Error('storage object has no generation');

        const decision = await confirmOrMark({
          kind: 'storage-without-firestore',
          storagePath: file.name,
          fingerprint: generation,
          nowMillis,
        });
        if (decision === 'marked') stats.marked += 1;
        if (decision !== 'confirmed') continue;

        // Final read closes the race after the confirmation window. A matching
        // generation precondition also prevents deleting a newly replaced file.
        const latestDocument = await document.get();
        const latestData = latestDocument.data() as
          | { storagePath?: unknown; thumbnailStoragePath?: unknown }
          | undefined;
        const nowLinked =
          latestDocument.exists &&
          (parsed.assetKind === 'full'
            ? latestData?.storagePath === file.name
            : latestData?.thumbnailStoragePath === file.name);
        if (nowLinked) {
          await clearMarker('storage-without-firestore', file.name);
          stats.preserved += 1;
          continue;
        }
        await file.delete({ ifGenerationMatch: Number(generation) });
        await clearMarker('storage-without-firestore', file.name);
        stats.deletedObjects += 1;
      } catch (error) {
        stats.failed += 1;
        logFunctionError(SCOPE, error, { stage: 'storage-object' });
      }
    }

    pageToken = nextQuery && 'pageToken' in nextQuery ? nextQuery.pageToken : undefined;
  } while (pageToken);
}

async function reconcileFirestoreDocuments(
  nowMillis: number,
  stats: CleanupStats,
): Promise<void> {
  const cutoff = Timestamp.fromMillis(nowMillis - ORPHAN_MIN_AGE_MS);
  const baseQuery = db
    .collectionGroup('progressPhotos')
    .where('createdAt', '<=', cutoff)
    .orderBy('createdAt', 'asc');
  const bucket = getStorage().bucket();
  let query = baseQuery.limit(MAX_METADATA_PER_RUN);

  for (;;) {
    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      stats.scannedDocuments += 1;

      try {
        const data = document.data() as { storagePath?: unknown };
        const storagePath =
          typeof data.storagePath === 'string' ? data.storagePath : '';
        const parsed = parsePhotoObjectPath(storagePath);
        const pathParts = document.ref.path.split('/');
        const pathMatches =
          parsed !== null &&
          parsed.assetKind === 'full' &&
          pathParts.length === 4 &&
          pathParts[0] === 'users' &&
          pathParts[1] === parsed.uid &&
          pathParts[2] === 'progressPhotos' &&
          pathParts[3] === parsed.photoId;
        if (!pathMatches || !document.updateTime) {
          stats.preserved += 1;
          continue;
        }

        const file = bucket.file(storagePath);
        const [exists] = await file.exists();
        if (exists) {
          await clearMarker('firestore-without-storage', storagePath);
          stats.preserved += 1;
          continue;
        }

        const fingerprint = String(document.updateTime.toMillis());
        const decision = await confirmOrMark({
          kind: 'firestore-without-storage',
          storagePath,
          fingerprint,
          nowMillis,
        });
        if (decision === 'marked') stats.marked += 1;
        if (decision !== 'confirmed') continue;

        // Recheck both sides and bind deletion to this exact Firestore version.
        const [nowExists] = await file.exists();
        const latest = await document.ref.get();
        if (
          nowExists ||
          !latest.exists ||
          latest.updateTime?.toMillis() !== document.updateTime.toMillis()
        ) {
          await clearMarker('firestore-without-storage', storagePath);
          stats.preserved += 1;
          continue;
        }

        await document.ref.delete({ lastUpdateTime: document.updateTime });
        await clearMarker('firestore-without-storage', storagePath);
        stats.deletedDocuments += 1;
      } catch (error) {
        stats.failed += 1;
        logFunctionError(SCOPE, error, { stage: 'firestore-document' });
      }
    }

    if (snapshot.docs.length < MAX_METADATA_PER_RUN) break;
    query = baseQuery.limit(MAX_METADATA_PER_RUN).startAfter(snapshot.docs.at(-1)!);
  }
}

export async function runPhotoVaultOrphanCleanup(
  nowMillis = Date.now(),
): Promise<CleanupStats> {
  const stats = emptyStats();

  try {
    await reconcileStorageObjects(nowMillis, stats);
  } catch (error) {
    stats.failed += 1;
    logFunctionError(SCOPE, error, { stage: 'storage-list' });
  }

  try {
    await reconcileFirestoreDocuments(nowMillis, stats);
  } catch (error) {
    stats.failed += 1;
    logFunctionError(SCOPE, error, { stage: 'firestore-list' });
  }

  // Aggregates only: object paths, photo IDs and user IDs never reach logs.
  logInfo(SCOPE, 'reconciliation complete', { ...stats });
  return stats;
}

export const cleanupPhotoVaultOrphans = onSchedule(
  {
    schedule: '30 3 * * *',
    timeZone: 'America/Sao_Paulo',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '256MiB',
    retryCount: 0,
  },
  async () => {
    await runPhotoVaultOrphanCleanup();
  },
);
