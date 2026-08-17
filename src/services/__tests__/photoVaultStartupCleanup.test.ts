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

  it('also sweeps the Comparator export queue on cold start (phase 15B)', () => {
    const source = readFileSync('App.tsx', 'utf8');

    expect(source).toContain('cleanupPhotoVaultShareFiles()');
    expect(source).toMatch(
      /useEffect\(\(\) => \{[\s\S]*cleanupPhotoVaultShareFiles\(\)/,
    );
    expect(source).toContain("logPhotoVaultIssue('startupCleanup', 'vaultShareCleanupFailed')");
  });

  it('keeps the share sweep in its own try/catch, independent of the temp sweep', () => {
    // A filesystem error sweeping one directory must never skip the other.
    const source = readFileSync('App.tsx', 'utf8');
    const bootstrapEffect = source.slice(
      source.indexOf('useEffect(() => {', source.indexOf('cleanupPhotoVaultTempFiles')),
      source.indexOf('}, []);', source.indexOf('cleanupPhotoVaultShareFiles')),
    );
    const tempTry = bootstrapEffect.indexOf('cleanupPhotoVaultTempFiles');
    const shareTry = bootstrapEffect.indexOf('cleanupPhotoVaultShareFiles');
    expect(tempTry).toBeGreaterThan(-1);
    expect(shareTry).toBeGreaterThan(tempTry);
    // Two separate `catch` blocks between the two calls, not one shared block.
    const between = bootstrapEffect.slice(tempTry, shareTry);
    expect(between).toContain('catch');
  });

  it('keeps the share sweep as its own function, never folded into the temp sweep', () => {
    // Structural guard against a future "simplification" — see the doc
    // comment on `cleanupPhotoVaultShareFiles` for why the two must stay
    // separate: the Vault's lock calls only the temp sweep, and folding
    // share/ into it would delete an export the OS share sheet is reading.
    const cleanup = readFileSync('src/services/photoVaultFileCrypto.ts', 'utf8');
    expect(cleanup).toContain("const SHARE_DIR = 'share'");
    expect(cleanup).toContain('export function cleanupPhotoVaultShareFiles');
    const tempSweep = cleanup.slice(
      cleanup.indexOf('export function cleanupPhotoVaultTempFiles'),
      cleanup.indexOf('export function cleanupPhotoVaultTempFiles') + 800,
    );
    expect(tempSweep).not.toContain('SHARE_DIR');
  });
});
