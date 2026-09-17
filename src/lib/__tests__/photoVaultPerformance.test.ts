import { describe, expect, it, vi } from 'vitest';

import { recordPhotoVaultCacheEvent, startPhotoVaultPerf } from '../photoVaultPerformance';

describe('Photo Vault performance instrumentation', () => {
  it('is silent unless the explicit development flag is active', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const previous = process.env.EXPO_PUBLIC_PHOTO_VAULT_PERF;
    delete process.env.EXPO_PUBLIC_PHOTO_VAULT_PERF;

    startPhotoVaultPerf('gallery.thumbnail.download')();
    expect(info).not.toHaveBeenCalled();

    if (previous === undefined) delete process.env.EXPO_PUBLIC_PHOTO_VAULT_PERF;
    else process.env.EXPO_PUBLIC_PHOTO_VAULT_PERF = previous;
    info.mockRestore();
  });

  it('accepts only closed stage labels and has no payload parameter', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultPerformance.ts', 'utf8');
    expect(source).toContain('EXPO_PUBLIC_PHOTO_VAULT_PERF');
    expect(source).toMatch(/startPhotoVaultPerf\(stage: PhotoVaultPerfStage\)/);
    expect(source).not.toMatch(/uid|photoId|sourceUri|storagePath|vaultKey/);
  });

  it('is equally silent for the cache and prefetch counters', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const previous = process.env.EXPO_PUBLIC_PHOTO_VAULT_PERF;
    delete process.env.EXPO_PUBLIC_PHOTO_VAULT_PERF;

    recordPhotoVaultCacheEvent('viewer.sessionCache.hit');
    recordPhotoVaultCacheEvent('viewer.fullCipherCache.miss', { bytes: 1024 });
    expect(info).not.toHaveBeenCalled();

    if (previous === undefined) delete process.env.EXPO_PUBLIC_PHOTO_VAULT_PERF;
    else process.env.EXPO_PUBLIC_PHOTO_VAULT_PERF = previous;
    info.mockRestore();
  });

  /**
   * The three layers the viewer now has are only useful if they stay
   * distinguishable: a single "cache hit" number that mixed a free session hit
   * with one that still decrypts would hide the cost it exists to measure.
   */
  it('names the session cache, the ciphertext cache and prefetch separately', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultPerformance.ts', 'utf8');

    for (const event of [
      'viewer.sessionCache.hit',
      'viewer.sessionCache.miss',
      'viewer.sessionCache.evicted',
      'viewer.sessionCache.cleared',
      'viewer.fullCipherCache.hit',
      'viewer.fullCipherCache.miss',
      'viewer.fullCipherCache.write',
      'viewer.fullCipherCache.evicted',
      'viewer.fullCipherCache.corrupt',
      'viewer.prefetch.started',
      'viewer.prefetch.completed',
      'viewer.prefetch.discarded',
    ]) {
      expect(source).toContain(`'${event}'`);
    }
  });

  /**
   * The recorder takes numbers and nothing else. A URI, a key or image content
   * has no parameter to travel through, which is what makes the DEV-only gate
   * a backstop rather than the only protection.
   */
  it('carries measurements only, never content', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultPerformance.ts', 'utf8');
    const metrics = source.slice(
      source.indexOf('export interface PhotoVaultCacheMetrics'),
      source.indexOf('export function recordPhotoVaultCacheEvent'),
    );
    expect(metrics).toMatch(/bytes\?: number/);
    expect(metrics).toMatch(/items\?: number/);
    expect(metrics).toMatch(/durationMs\?: number/);
    expect(metrics).not.toMatch(/string/);
  });
});
