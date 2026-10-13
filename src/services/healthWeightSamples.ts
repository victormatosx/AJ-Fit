import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import {
  healthWeightSampleDocId,
  isValidHealthWeightSample,
  type HealthWeightSample,
  type HealthWeightSampleDoc,
} from '../types/healthWeightSync';

/**
 * Persistence for imported, independent weight readings — Fase 3.
 *
 * Deliberately its own subcollection, never `assessments`: see the doc
 * comment on `healthWeightSamples` in `firestore.rules` for why mixing the
 * two would both fabricate data (assessments require a height) and risk
 * silently feeding the nutrition engine's TDEE weight resolution
 * (`functions/src/nutrition/generation/context.ts` reads `assessments`
 * directly).
 *
 * Dedup is structural, not best-effort: the document ID is always platform +
 * SHA-256 of the versioned native identity tuple (see `healthWeightSampleDocId`). Firestore Rules
 * only allow `create` on this path (never `update`), so re-importing the
 * same native sample must be filtered out *before* writing — a blind
 * `setDoc` on an existing ID would be rejected as an update, not silently
 * accepted as a no-op.
 */

const COLLECTION = 'healthWeightSamples';
/** Comfortably under the 500-write batch limit, leaving headroom. */
const WRITE_CHUNK_SIZE = 200;

function samplesRef(uid: string) {
  return collection(db, 'users', uid, COLLECTION);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function fromSnap(d: QueryDocumentSnapshot<DocumentData>): HealthWeightSampleDoc {
  const data = d.data();
  return {
    id: d.id,
    platform: data.platform as HealthWeightSampleDoc['platform'],
    sourceId: data.sourceId as string,
    sourceApp: (data.sourceApp as string | undefined) ?? null,
    measuredAt: (data.measuredAt as Timestamp).toDate(),
    weightKg: data.weightKg as number,
    createdAt: (data.createdAt as Timestamp | undefined)?.toDate() ?? null,
  };
}

export type ImportHealthWeightSamplesResult = {
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  /** The newest `measuredAt` actually persisted — the only safe value for a caller to advance its sync checkpoint to. `null` when nothing was written. */
  latestMeasuredAt: Date | null;
  /** A later chunk failed to commit — some earlier chunks may already be persisted. The caller should only trust `latestMeasuredAt`, not assume everything in `samples` made it in. */
  partialFailure: boolean;
};

/**
 * Validates and persists a batch of already-normalized samples. Invalid
 * samples are skipped individually — never abort the whole batch over one
 * bad entry. Duplicates (by deterministic ID) are filtered out before any
 * write is attempted. Writes happen in ascending `measuredAt` order and in
 * bounded batches so a mid-import failure leaves a clean, resumable
 * checkpoint rather than a scattered partial state.
 */
export async function importHealthWeightSamples(
  uid: string,
  samples: readonly HealthWeightSample[],
): Promise<ImportHealthWeightSamplesResult> {
  const valid = samples.filter(isValidHealthWeightSample);
  const skippedInvalid = samples.length - valid.length;
  if (valid.length === 0) {
    return { imported: 0, skippedDuplicates: 0, skippedInvalid, latestMeasuredAt: null, partialFailure: false };
  }

  const withIds = await Promise.all(valid.map(async (sample) => ({
    sample,
    id: await healthWeightSampleDocId(sample),
  })));
  const uniqueById = new Map<string, (typeof withIds)[number]>();
  for (const candidate of withIds) {
    if (!uniqueById.has(candidate.id)) uniqueById.set(candidate.id, candidate);
  }
  const candidates = [...uniqueById.values()]
    .sort((a, b) => a.sample.measuredAt.getTime() - b.sample.measuredAt.getTime());
  let skippedDuplicates = withIds.length - candidates.length;

  let imported = 0;
  let latestMeasuredAt: Date | null = null;
  let partialFailure = false;

  for (const batch of chunk(candidates, WRITE_CHUNK_SIZE)) {
    if (batch.length === 0) continue;
    try {
      const committed = await runTransaction(db, async (transaction) => {
        // Read-before-write is required by Firestore transactions. If a
        // second device creates an id concurrently, Firestore retries and
        // the record becomes an ordinary duplicate instead of a failed update.
        const refs = batch.map(({ id }) => doc(samplesRef(uid), id));
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        const inserted: typeof batch = [];
        snapshots.forEach((snapshot, index) => {
          if (snapshot.exists()) return;
          const candidate = batch[index]!;
          const { sample } = candidate;
          const data: Record<string, unknown> = {
            platform: sample.platform,
            sourceId: sample.sourceId,
            measuredAt: Timestamp.fromDate(sample.measuredAt),
            createdAt: serverTimestamp(),
            weightKg: sample.weightKg,
          };
          if (sample.sourceApp) data.sourceApp = sample.sourceApp;
          transaction.set(refs[index]!, data);
          inserted.push(candidate);
        });
        return inserted;
      });
      imported += committed.length;
      skippedDuplicates += batch.length - committed.length;
      if (committed.length > 0) {
        latestMeasuredAt = committed[committed.length - 1]!.sample.measuredAt;
      }
    } catch {
      // Stop at the first failed chunk — everything before it is confirmed
      // persisted (reflected in `latestMeasuredAt`), everything from here on
      // (including the rest of this failed chunk) simply gets re-attempted.
      // Deterministic ids and the transaction make the retry idempotent.
      partialFailure = true;
      break;
    }
  }

  return { imported, skippedDuplicates, skippedInvalid, latestMeasuredAt, partialFailure };
}

/**
 * Most recent samples first, capped at `max`. Used by the Evolution screen's
 * dedicated imported-weight section — never merged into `assessments`.
 */
export async function listHealthWeightSamples(uid: string, max = 200): Promise<HealthWeightSampleDoc[]> {
  const q = query(samplesRef(uid), orderBy('measuredAt', 'desc'), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(fromSnap);
}

/**
 * Deletes every imported weight sample for this user — the "excluir dados
 * importados" action, explicitly distinct from disconnecting (which keeps
 * this data). Never touches `assessments` or any manually-entered record;
 * this subcollection exists solely for data this exact function is allowed
 * to delete. Chunked deletes so an interruption only ever leaves a subset
 * removed, never a corrupted document.
 */
export async function deleteAllHealthWeightSamples(uid: string): Promise<{ deleted: number }> {
  const snap = await getDocs(samplesRef(uid));
  let deleted = 0;
  for (const batchDocs of chunk(snap.docs, WRITE_CHUNK_SIZE)) {
    if (batchDocs.length === 0) continue;
    const writer = writeBatch(db);
    for (const docSnap of batchDocs) writer.delete(docSnap.ref);
    await writer.commit();
    deleted += batchDocs.length;
  }
  return { deleted };
}

export { healthWeightSampleDocId } from '../types/healthWeightSync';
export type { HealthWeightSampleDoc } from '../types/healthWeightSync';

// Exposed for tests only (deterministic doc-id delete-by-id is a building
// block `deleteAllHealthWeightSamples` doesn't need, but a future per-sample
// delete UI would).
export async function deleteHealthWeightSampleById(uid: string, sampleId: string): Promise<void> {
  await deleteDoc(doc(samplesRef(uid), sampleId));
}
