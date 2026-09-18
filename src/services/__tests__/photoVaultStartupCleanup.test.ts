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
  });

  /**
   * The sweep above used to be justified by "a cold process has no resumable
   * local upload queue". A prepared photo now survives a force-kill, so that
   * sentence is false and the reason the sweep is still safe has changed: the
   * durable queue lives somewhere the sweep physically cannot reach.
   */
  it('never deletes a pending upload, because the queue is not under the cache root', () => {
    const durable = readFileSync('src/services/photoVaultDurableStore.ts', 'utf8');
    const cleanup = readFileSync('src/services/photoVaultFileCrypto.ts', 'utf8');

    // The only thing standing between a force-kill and a lost photo. Every
    // directory this module builds must be rooted in the document tree; the
    // cache root may be discussed in prose but never constructed.
    expect(durable).toContain('new Directory(Paths.document');
    expect(durable).not.toMatch(/new (Directory|File)\(\s*Paths\.cache/);
    // The sweep lists exactly two names, both under the cache root, and
    // neither is the pending store.
    expect(cleanup).toContain("const ENCRYPTED_DIR = 'enc'");
    expect(cleanup).toContain("const PLAINTEXT_DIR = 'tmp'");
    expect(cleanup).not.toContain('photo-vault-pending');
  });

  it('reconciles the durable queue on cold start instead of assuming it is empty', () => {
    const source = readFileSync('App.tsx', 'utf8');
    expect(source).toContain('reconcilePhotoVaultUploadQueue()');
    expect(source).toContain("kickPhotoVaultUploadQueue('cold-start')");
    // The stale justification must not survive as a comment either — it would
    // be the single most misleading line in the bootstrap.
    expect(source).not.toContain('no resumable local upload queue');
  });

  it('drops a pending job only on proof, never on suspicion', () => {
    const queue = readFileSync('src/services/photoVaultUploadQueue.ts', 'utf8');
    const reconcile = queue.slice(queue.indexOf('export async function reconcilePhotoVaultUploadQueue'));
    // Exactly two grounds for dropping a job: it expired, or its ciphertext is
    // gone. Neither is recoverable; everything else is kept and retried.
    expect(reconcile).toContain('isJobExpired(job, timestamp)');
    expect(reconcile).toContain('!durableAssetIsIntact(job.uid, job.assetId, job)');
  });

  it('never writes plaintext into the durable store', () => {
    // The document directory is backed up and is swept by nothing, so a
    // plaintext file here would be the most durable privacy failure the vault
    // could have.
    const durable = readFileSync('src/services/photoVaultDurableStore.ts', 'utf8');
    expect(durable).toContain("const FULL_SUFFIX = '.enc'");
    expect(durable).toContain("const THUMBNAIL_SUFFIX = '.thumb.enc'");
    // Only the encryption step may name a path in this store.
    const service = readFileSync('src/services/progressPhotos.ts', 'utf8');
    const prepare = service.slice(
      service.indexOf('export async function prepareProgressPhotoUpload'),
      service.indexOf('function assetRef('),
    );
    expect(prepare).toContain('targetUri: fullUri');
    expect(prepare).toContain('targetUri: thumbnailUri');
    // The plaintext thumbnail is released in the same function that made it.
    expect(prepare).toContain('discardDecryptedPhoto(thumbnailPlaintextUri)');
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
    // Both caches are siblings of those two, so they are invisible to that
    // listing. That is what lets ciphertext — and only ciphertext — outlive a
    // lock and a cold start while every plaintext representation is swept.
    expect(cache).toContain("const CACHE_DIR = 'encrypted-thumbnails'");
    expect(cache).toContain("const FULL_CACHE_DIR = 'encrypted-fulls'");
    expect(cleanup).not.toContain('encrypted-thumbnails');
    expect(cleanup).not.toContain('encrypted-fulls');
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
