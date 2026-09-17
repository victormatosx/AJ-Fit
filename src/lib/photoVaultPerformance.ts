import { logDebug } from './logger';

/**
 * Development-only Photo Vault timings.
 *
 * Enable in a development bundle with:
 *   EXPO_PUBLIC_PHOTO_VAULT_PERF=1 npx expo start --dev-client
 *
 * Labels are a closed, non-identifying vocabulary. Values are durations or
 * aggregate byte counts only; paths, IDs, keys and payloads never enter it.
 */

export type PhotoVaultPerfStage =
  | 'upload.total'
  | 'upload.thumbnail.generate'
  | 'upload.full.encrypt'
  | 'upload.thumbnail.encrypt'
  | 'upload.full.transfer'
  | 'upload.thumbnail.transfer'
  | 'upload.firestore'
  | 'gallery.firestore.list'
  | 'gallery.thumbnail.download'
  | 'gallery.thumbnail.decrypt'
  | 'gallery.thumbnail.render-ready'
  | 'gallery.thumbnail.cache-read'
  | 'gallery.thumbnail.cache-write'
  | 'gallery.thumbnail.cache-hit.render-ready'
  | 'gallery.thumbnail.cache-miss.render-ready'
  | 'gallery.legacy-full.download'
  | 'gallery.legacy-full.decrypt'
  | 'gallery.legacy-full.cache-read'
  | 'gallery.legacy-full.cache-write'
  | 'viewer.full.download'
  | 'viewer.full.decrypt'
  | 'viewer.full.cache-read'
  | 'viewer.full.cache-write'
  | 'viewer.placeholder.render-ready'
  | 'viewer.full.render-ready'
  | 'compare.before.full-load'
  | 'compare.after.full-load'
  | 'compare.preview.ready'
  | 'compare.capture.duration'
  | 'compare.share.duration'
  | 'delete.full.storage'
  | 'delete.thumbnail.storage'
  | 'delete.firestore'
  | 'delete.total'
  | 'picker.library'
  | 'picker.camera'
  | 'picker.normalize'
  // Local-first split. `prepare` is what the user actually waits for; `sync`
  // happens after the sheet has closed and is not on the perceived path.
  | 'upload.prepare.total'
  | 'upload.sync.total'
  | 'upload.sync.full.transfer'
  | 'upload.sync.thumbnail.transfer'
  | 'upload.sync.firestore'
  | 'upload.sync.probe';

export type PhotoVaultPerfEvent =
  | 'compare.capture.start'
  | 'compare.capture.complete'
  | 'compare.capture.failed'
  | 'compare.share.start'
  | 'compare.share.complete'
  | 'compare.share.failed';

function isEnabled(): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    process.env.EXPO_PUBLIC_PHOTO_VAULT_PERF === '1'
  );
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function startPhotoVaultPerf(stage: PhotoVaultPerfStage): () => number {
  const startedAt = now();
  return () => {
    const durationMs = Math.max(0, Math.round(now() - startedAt));
    if (isEnabled()) logDebug('photoVault:perf', stage, { durationMs });
    return durationMs;
  };
}

/** Closed, non-identifying capture lifecycle events and aggregate byte size. */
export function recordPhotoVaultPerfEvent(
  event: PhotoVaultPerfEvent,
  metrics?: { bytes: number },
): void {
  if (!isEnabled()) return;
  logDebug('photoVault:perf', event, metrics ? { bytes: metrics.bytes } : undefined);
}

/**
 * Sizes along the save pipeline, so the 1600px/0.85 choice can be revisited
 * with measurements instead of intuition.
 *
 * Kept to the same closed vocabulary and the same DEV-only gate as the timings
 * above. A byte count and a pixel dimension describe the pipeline, not the
 * person: they cannot identify a photo, a day, a pose or a user. The signature
 * accepts numbers and nothing else, so no identifier, path or image content
 * can be passed in even by mistake.
 */
export type PhotoVaultByteMetric =
  /** What the picker handed us, before any transformation. */
  | 'picker.source'
  /** After resize + JPEG re-encode — what actually gets encrypted. */
  | 'picker.normalized'
  /** The 480px grid derivative, before encryption. */
  | 'upload.thumbnail.plaintext'
  /** The two envelopes that reach Storage. */
  | 'upload.full.encrypted'
  | 'upload.thumbnail.encrypted';

export interface PhotoVaultSizeSample {
  bytes: number;
  width?: number;
  height?: number;
}

export function recordPhotoVaultBytes(
  metric: PhotoVaultByteMetric,
  sample: PhotoVaultSizeSample,
): void {
  if (!isEnabled()) return;
  logDebug('photoVault:perf', metric, {
    bytes: sample.bytes,
    ...(sample.width !== undefined ? { width: sample.width } : {}),
    ...(sample.height !== undefined ? { height: sample.height } : {}),
  });
}

/**
 * Running hit/miss tally for the encrypted thumbnail cache.
 *
 * Counters only: `avoidedRequests` is exactly how many Storage downloads the
 * cache removed from the critical path since process start, which is the
 * number this phase is judged on. Nothing identifying is recorded — an
 * aggregate count cannot describe which images a person owns.
 */
const cacheOutcomes = { hits: 0, misses: 0 };

export function recordPhotoVaultCacheOutcome(outcome: 'hit' | 'miss'): void {
  if (outcome === 'hit') cacheOutcomes.hits += 1;
  else cacheOutcomes.misses += 1;
  if (isEnabled()) {
    logDebug('photoVault:perf', 'gallery.thumbnail.cache', { ...cacheOutcomes });
  }
}

export function photoVaultCacheCounters(): {
  hits: number;
  misses: number;
  avoidedRequests: number;
} {
  return { ...cacheOutcomes, avoidedRequests: cacheOutcomes.hits };
}

/**
 * Closed vocabulary for the viewer's two caches and its prefetch window.
 *
 * Three layers, deliberately named apart, because conflating them is what
 * makes a "cache hit" number meaningless:
 *
 *   sessionCache    plaintext already decrypted and still held by this
 *                   unlocked session. A hit costs nothing at all.
 *   fullCipherCache on-device CIPHERTEXT. A hit still decrypts, but pays no
 *                   network — this is the layer that survives a lock.
 *   prefetch        speculative neighbour work, which may legitimately be
 *                   thrown away when the user swipes past it.
 */
export type PhotoVaultCacheEvent =
  | 'viewer.sessionCache.hit'
  | 'viewer.sessionCache.miss'
  | 'viewer.sessionCache.evicted'
  | 'viewer.sessionCache.cleared'
  | 'viewer.fullCipherCache.hit'
  | 'viewer.fullCipherCache.miss'
  | 'viewer.fullCipherCache.write'
  | 'viewer.fullCipherCache.evicted'
  | 'viewer.fullCipherCache.corrupt'
  | 'viewer.prefetch.started'
  | 'viewer.prefetch.completed'
  | 'viewer.prefetch.discarded'
  | 'gallery.thumbnailCipherCache.write'
  | 'gallery.thumbnailCipherCache.evicted';

/**
 * Numbers only, by signature.
 *
 * Same rule as every other recorder in this module: a byte count, an item
 * count and a duration describe the pipeline, never the person. There is no
 * field an identifier, a path, a key or image content could travel through.
 */
export interface PhotoVaultCacheMetrics {
  bytes?: number;
  items?: number;
  durationMs?: number;
}

export function recordPhotoVaultCacheEvent(
  event: PhotoVaultCacheEvent,
  metrics?: PhotoVaultCacheMetrics,
): void {
  if (!isEnabled()) return;
  logDebug('photoVault:perf', event, {
    ...(metrics?.bytes !== undefined ? { bytes: metrics.bytes } : {}),
    ...(metrics?.items !== undefined ? { items: metrics.items } : {}),
    ...(metrics?.durationMs !== undefined ? { durationMs: metrics.durationMs } : {}),
  });
}

/** Test seam. */
export function resetPhotoVaultCacheCountersForTesting(): void {
  cacheOutcomes.hits = 0;
  cacheOutcomes.misses = 0;
}
