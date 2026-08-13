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
    if (isEnabled()) console.info(`[photoVault:perf] ${stage} = ${durationMs}ms`);
    return durationMs;
  };
}
