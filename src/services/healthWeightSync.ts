import { getHealthPlatform } from './healthIntegration';
import {
  readAndroidWeightChanges,
  readAndroidWeightHistoryPage,
  readIosWeightChanges,
  HealthWeightNativeError,
} from './healthWeightNative';
import { importHealthWeightSamples } from './healthWeightSamples';
import {
  createHealthWeightSyncCheckpoint,
  effectiveHealthWeightHistoryStart,
  readHealthWeightSyncCheckpoint,
  writeHealthWeightSyncCheckpoint,
} from './healthWeightSyncCheckpoint';
import type {
  HealthWeightPlatform,
  HealthWeightSample,
  HealthWeightSyncCheckpoint,
  HealthWeightSyncStatus,
} from '../types/healthWeightSync';

export type HealthWeightSyncRunResult = {
  status: Exclude<HealthWeightSyncStatus, 'idle' | 'syncing'>;
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  lastSuccessfulAt: Date | null;
};

export type HealthWeightSyncOptions = {
  /** Logical cancellation for uid switches/disconnects; native calls themselves are not cancellable. */
  shouldContinue?: () => boolean;
};

class HealthWeightSyncCancelled extends Error {}
const inFlightByIdentity = new Map<string, Promise<HealthWeightSyncRunResult>>();
const MAX_PAGES_PER_RUN = 500;

function ensureCurrent(options: HealthWeightSyncOptions): void {
  if (options.shouldContinue && !options.shouldContinue()) throw new HealthWeightSyncCancelled();
}

async function persist(
  uid: string,
  samples: readonly HealthWeightSample[],
  historyStart: Date,
  options: HealthWeightSyncOptions,
): Promise<{ imported: number; skippedDuplicates: number; skippedInvalid: number }> {
  ensureCurrent(options);
  const inWindow = samples.filter((sample) => sample.measuredAt >= historyStart);
  const ignoredByWindow = samples.length - inWindow.length;
  const result = await importHealthWeightSamples(uid, inWindow);
  ensureCurrent(options);
  if (result.partialFailure) throw new Error('health_weight_partial_persistence_failure');
  return {
    imported: result.imported,
    skippedDuplicates: result.skippedDuplicates,
    skippedInvalid: result.skippedInvalid + ignoredByWindow,
  };
}

function addCounts(
  total: { imported: number; skippedDuplicates: number; skippedInvalid: number },
  page: { imported: number; skippedDuplicates: number; skippedInvalid: number },
): void {
  total.imported += page.imported;
  total.skippedDuplicates += page.skippedDuplicates;
  total.skippedInvalid += page.skippedInvalid;
}

async function completeCheckpoint(
  uid: string,
  checkpoint: HealthWeightSyncCheckpoint,
  cursor: string,
): Promise<HealthWeightSyncCheckpoint> {
  const next = {
    ...checkpoint,
    cursor,
    lastSuccessfulAtIso: new Date().toISOString(),
  };
  await writeHealthWeightSyncCheckpoint(uid, next);
  return next;
}

async function syncIos(
  uid: string,
  checkpoint: HealthWeightSyncCheckpoint,
  options: HealthWeightSyncOptions,
): Promise<HealthWeightSyncRunResult> {
  const counts = { imported: 0, skippedDuplicates: 0, skippedInvalid: 0 };
  const historyStart = effectiveHealthWeightHistoryStart(checkpoint);
  let cursor = checkpoint.cursor;
  let pages = 0;
  while (pages++ < MAX_PAGES_PER_RUN) {
    ensureCurrent(options);
    const page = await readIosWeightChanges(historyStart, cursor);
    addCounts(counts, await persist(uid, page.samples, historyStart, options));
    // Deleted source records intentionally do not delete AJ Fit data. The
    // product contract imports measurements; only the user's explicit AJ Fit
    // delete action removes imported documents.
    checkpoint = await completeCheckpoint(uid, checkpoint, page.nextCursor);
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  }
  if (pages > MAX_PAGES_PER_RUN) throw new Error('health_weight_page_limit_exceeded');
  const lastSuccessfulAt = checkpoint.lastSuccessfulAtIso
    ? new Date(checkpoint.lastSuccessfulAtIso)
    : null;
  return {
    status: counts.imported > 0 ? 'success' : 'no_data',
    ...counts,
    lastSuccessfulAt,
  };
}

async function bootstrapAndroid(
  uid: string,
  checkpoint: HealthWeightSyncCheckpoint,
  options: HealthWeightSyncOptions,
  counts: { imported: number; skippedDuplicates: number; skippedInvalid: number },
): Promise<HealthWeightSyncCheckpoint> {
  const historyStart = effectiveHealthWeightHistoryStart(checkpoint);
  // Establish the changes token before scanning history. A record inserted
  // during the paginated scan is then guaranteed to appear after this token.
  let changes = await readAndroidWeightChanges(null);
  let pageToken: string | undefined;
  let pages = 0;
  do {
    ensureCurrent(options);
    const page = await readAndroidWeightHistoryPage(historyStart, pageToken);
    addCounts(counts, await persist(uid, page.samples, historyStart, options));
    pageToken = page.nextPageToken ?? undefined;
    if (++pages > MAX_PAGES_PER_RUN) throw new Error('health_weight_page_limit_exceeded');
  } while (pageToken);

  // Only now may the token be committed: every record preceding it has been
  // durably considered by the historical scan.
  while (true) {
    addCounts(counts, await persist(uid, changes.samples, historyStart, options));
    checkpoint = await completeCheckpoint(uid, checkpoint, changes.nextCursor);
    if (!changes.hasMore) return checkpoint;
    ensureCurrent(options);
    changes = await readAndroidWeightChanges(changes.nextCursor);
    if (++pages > MAX_PAGES_PER_RUN) throw new Error('health_weight_page_limit_exceeded');
  }
}

async function syncAndroid(
  uid: string,
  checkpoint: HealthWeightSyncCheckpoint,
  options: HealthWeightSyncOptions,
): Promise<HealthWeightSyncRunResult> {
  const counts = { imported: 0, skippedDuplicates: 0, skippedInvalid: 0 };
  const historyStart = effectiveHealthWeightHistoryStart(checkpoint);
  if (!checkpoint.cursor) {
    checkpoint = await bootstrapAndroid(uid, checkpoint, options, counts);
  } else {
    let pages = 0;
    while (pages++ < MAX_PAGES_PER_RUN) {
      ensureCurrent(options);
      const page = await readAndroidWeightChanges(checkpoint.cursor);
      if (page.cursorExpired) {
        checkpoint = { ...checkpoint, cursor: null };
        checkpoint = await bootstrapAndroid(uid, checkpoint, options, counts);
        break;
      }
      addCounts(counts, await persist(uid, page.samples, historyStart, options));
      checkpoint = await completeCheckpoint(uid, checkpoint, page.nextCursor);
      if (!page.hasMore) break;
    }
    if (pages > MAX_PAGES_PER_RUN) throw new Error('health_weight_page_limit_exceeded');
  }
  return {
    status: counts.imported > 0 ? 'success' : 'no_data',
    ...counts,
    lastSuccessfulAt: checkpoint.lastSuccessfulAtIso
      ? new Date(checkpoint.lastSuccessfulAtIso)
      : null,
  };
}

async function run(uid: string, platform: HealthWeightPlatform, options: HealthWeightSyncOptions) {
  const checkpoint = await readHealthWeightSyncCheckpoint(uid, platform)
    ?? createHealthWeightSyncCheckpoint(platform);
  return platform === 'ios'
    ? syncIos(uid, checkpoint, options)
    : syncAndroid(uid, checkpoint, options);
}

export async function syncHealthWeightSamples(
  uid: string,
  options: HealthWeightSyncOptions = {},
): Promise<HealthWeightSyncRunResult> {
  const platform = getHealthPlatform();
  if (platform === 'unsupported') {
    return { status: 'unavailable', imported: 0, skippedDuplicates: 0, skippedInvalid: 0, lastSuccessfulAt: null };
  }
  const identity = `${uid}:${platform}`;
  const existing = inFlightByIdentity.get(identity);
  if (existing) return existing;
  const operation = run(uid, platform, options).catch((cause): HealthWeightSyncRunResult => {
    if (cause instanceof HealthWeightSyncCancelled) throw cause;
    if (cause instanceof HealthWeightNativeError) {
      return {
        status: cause.code === 'permission_required'
          ? 'permission_required'
          : cause.code === 'unavailable' ? 'unavailable' : 'error',
        imported: 0,
        skippedDuplicates: 0,
        skippedInvalid: 0,
        lastSuccessfulAt: null,
      };
    }
    return { status: 'error', imported: 0, skippedDuplicates: 0, skippedInvalid: 0, lastSuccessfulAt: null };
  });
  inFlightByIdentity.set(identity, operation);
  try {
    return await operation;
  } finally {
    if (inFlightByIdentity.get(identity) === operation) inFlightByIdentity.delete(identity);
  }
}

export function isHealthWeightSyncCancellation(cause: unknown): boolean {
  return cause instanceof HealthWeightSyncCancelled;
}
