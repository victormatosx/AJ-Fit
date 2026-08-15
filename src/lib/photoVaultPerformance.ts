import { logDebug } from './logger';

/**
 * Development-only Photo Vault timings.
 *
 * Enable in a development bundle with:
 *   EXPO_PUBLIC_PHOTO_VAULT_PERF=1 npx expo start --dev-client
 *
 * Labels are a closed, non-identifying vocabulary. Values are durations
 * only; paths, photo IDs, user IDs, keys and payloads never enter this API.
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
  | 'viewer.full.download'
  | 'viewer.full.decrypt'
  | 'viewer.placeholder.render-ready'
  | 'viewer.full.render-ready'
  | 'delete.full.storage'
  | 'delete.thumbnail.storage'
  | 'delete.firestore'
  | 'delete.total'
  | 'picker.library'
  | 'picker.camera'
  | 'picker.normalize';

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

/** Test seam. */
export function resetPhotoVaultCacheCountersForTesting(): void {
  cacheOutcomes.hits = 0;
  cacheOutcomes.misses = 0;
}
