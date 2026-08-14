import { describe, expect, it, vi } from 'vitest';

import { startPhotoVaultPerf } from '../photoVaultPerformance';

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
});
