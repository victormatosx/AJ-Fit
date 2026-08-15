import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Photo Vault startup cleanup', () => {
  it('sweeps plaintext during app bootstrap without blocking startup on failure', () => {
    const source = readFileSync('App.tsx', 'utf8');

    expect(source).toContain('cleanupPhotoVaultTempFiles({ includeEncrypted: true })');
    expect(source).toMatch(
      /useEffect\(\(\) => \{[\s\S]*cleanupPhotoVaultTempFiles\(\{ includeEncrypted: true \}\)/,
    );
    expect(source).toContain("logPhotoVaultIssue('startupCleanup', 'vaultTempCleanupFailed')");
  });

  it('also removes encrypted staging after a cold process restart', () => {
    const source = readFileSync('App.tsx', 'utf8');
    expect(source).toContain('includeEncrypted: true');
    expect(source).toContain('no resumable local upload queue');
  });

  it('never clears the persistent encrypted thumbnail cache at startup', () => {
    const source = readFileSync('App.tsx', 'utf8');
    // Surviving a cold start is the whole point of that cache. Bootstrap must
    // not reach for any of its removal entry points.
    expect(source).not.toContain('pruneCachedThumbnailsExcept');
    expect(source).not.toContain('removeCachedThumbnailsForUser');
    expect(source).not.toContain('photoVaultEncryptedCache');
  });

  it('keeps the swept directories disjoint from the cache directory', () => {
    const cleanup = readFileSync('src/services/photoVaultFileCrypto.ts', 'utf8');
    const cache = readFileSync('src/services/photoVaultEncryptedCache.ts', 'utf8');

    // The sweep only ever lists these two names.
    expect(cleanup).toContain("const ENCRYPTED_DIR = 'enc'");
    expect(cleanup).toContain("const PLAINTEXT_DIR = 'tmp'");
    // The cache is a sibling of both, so it is invisible to that listing.
    expect(cache).toContain("const CACHE_DIR = 'encrypted-thumbnails'");
    expect(cleanup).not.toContain('encrypted-thumbnails');
  });
});
