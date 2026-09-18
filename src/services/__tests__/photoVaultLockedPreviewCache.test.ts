import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory filesystem mirroring the parts of the expo-file-system 56 API the
 * locked-preview cache uses. Same harness shape as
 * `photoVaultEncryptedCache.test.ts` for the same module.
 */
const fs = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; mtime: number }>(),
  dirs: new Set<string>(),
  failWrite: false,
  failMove: false,
  uuid: 0,
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${(fs.uuid += 1)}` }));

vi.mock('expo-file-system', () => {
  const join = (...parts: string[]) => parts.join('/').replace(/([^:])\/{2,}/g, '$1/');

  const childrenOf = (base: string) => {
    const prefix = `${base}/`;
    const names = new Set<string>();
    for (const uri of [...fs.files.keys(), ...fs.dirs]) {
      if (!uri.startsWith(prefix)) continue;
      const rest = uri.slice(prefix.length);
      if (rest.length === 0) continue;
      names.add(rest.split('/')[0]!);
    }
    return [...names].map((name) => `${prefix}${name}`);
  };

  class Directory {
    uri: string;
    constructor(...parts: (string | Directory | File)[]) {
      this.uri = join(...parts.map((p) => (typeof p === 'string' ? p : p.uri)));
    }
    create() {
      fs.dirs.add(this.uri);
    }
    get exists() {
      return fs.dirs.has(this.uri);
    }
    list(): (Directory | File)[] {
      if (!fs.dirs.has(this.uri)) throw new Error('ENOENT');
      return childrenOf(this.uri).map((uri) =>
        fs.dirs.has(uri) ? new Directory(uri) : new File(uri),
      );
    }
    delete() {
      if (!fs.dirs.has(this.uri)) throw new Error('ENOENT');
      for (const uri of [...fs.files.keys()]) {
        if (uri.startsWith(`${this.uri}/`)) fs.files.delete(uri);
      }
      for (const uri of [...fs.dirs]) {
        if (uri === this.uri || uri.startsWith(`${this.uri}/`)) fs.dirs.delete(uri);
      }
    }
  }

  class File {
    uri: string;
    constructor(...parts: (string | Directory | File)[]) {
      this.uri = join(...parts.map((p) => (typeof p === 'string' ? p : p.uri)));
    }
    get exists() {
      return fs.files.has(this.uri);
    }
    get size() {
      return fs.files.get(this.uri)?.bytes.length ?? 0;
    }
    get lastModified() {
      return fs.files.get(this.uri)?.mtime ?? null;
    }
    async bytes() {
      const entry = fs.files.get(this.uri);
      if (!entry) throw new Error('ENOENT');
      return new Uint8Array(entry.bytes);
    }
    write(bytes: Uint8Array) {
      if (fs.failWrite) throw new Error('EIO');
      fs.files.set(this.uri, { bytes: new Uint8Array(bytes), mtime: Date.now() });
    }
    moveSync(target: File | Directory, options?: { overwrite?: boolean }) {
      if (fs.failMove) throw new Error('EIO');
      const entry = fs.files.get(this.uri);
      if (!entry) throw new Error('ENOENT');
      if (!options?.overwrite && fs.files.has(target.uri)) throw new Error('EEXIST');
      fs.files.set(target.uri, entry);
      fs.files.delete(this.uri);
    }
    delete() {
      if (!fs.files.has(this.uri)) throw new Error('ENOENT');
      fs.files.delete(this.uri);
    }
  }

  const Paths = { cache: 'file:///cache' };

  return { Directory, File, Paths };
});

import {
  MAX_LOCKED_PREVIEW_BYTES,
  MAX_LOCKED_PREVIEW_ENTRIES,
  currentPhotoVaultLockedPreviewEpoch,
  hasLockedPreviewDerivative,
  listLockedPreviewUris,
  photoVaultLockedPreviewCacheStats,
  pruneLockedPreviewDerivativesExcept,
  removeLockedPreviewDerivative,
  removeLockedPreviewDerivativesForUser,
  resetPhotoVaultLockedPreviewCacheForTesting,
  writeLockedPreviewDerivative,
} from '../photoVaultLockedPreviewCache';

beforeEach(() => {
  fs.files.clear();
  fs.dirs.clear();
  fs.failWrite = false;
  fs.failMove = false;
  fs.uuid = 0;
  resetPhotoVaultLockedPreviewCacheForTesting();
});

const BYTES = new Uint8Array([1, 2, 3]);

describe('writeLockedPreviewDerivative', () => {
  it('stores the bytes, retrievable by listing the uid namespace', () => {
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    expect(writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-1', bytes: BYTES, epoch })).toBe(true);

    const uris = listLockedPreviewUris('uid-a');
    expect(uris).toHaveLength(1);
    expect(uris[0]).toContain('asset-1.preview.jpg');
    expect(hasLockedPreviewDerivative('uid-a', 'asset-1')).toBe(true);
  });

  it('refuses a write carrying a stale epoch, so a late result cannot repopulate a cleared namespace', () => {
    const staleEpoch = currentPhotoVaultLockedPreviewEpoch();
    pruneLockedPreviewDerivativesExcept('uid-b'); // bumps the epoch, as a uid switch would

    expect(
      writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-1', bytes: BYTES, epoch: staleEpoch }),
    ).toBe(false);
    expect(listLockedPreviewUris('uid-a')).toHaveLength(0);
  });

  it('writes atomically: a failed move never leaves the final name readable', () => {
    fs.failMove = true;
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    expect(writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-1', bytes: BYTES, epoch })).toBe(false);
    expect(listLockedPreviewUris('uid-a')).toHaveLength(0);
    // The abandoned temp file is not left behind as a readable entry either.
    expect([...fs.files.keys()].some((uri) => uri.includes('asset-1.preview.jpg'))).toBe(false);
  });

  it('never lets a half-written temp file be read as a cache hit', () => {
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-1', bytes: BYTES, epoch });
    // Simulate a crash mid-write on a second entry: a temp file with no
    // matching final name.
    fs.files.set('file:///cache/photo-vault/locked-preview/uid-a/.tmp-orphan', { bytes: BYTES, mtime: Date.now() });

    const uris = listLockedPreviewUris('uid-a');
    expect(uris).toHaveLength(1);
    expect(uris.every((uri) => !uri.includes('.tmp-'))).toBe(true);
  });

  it('rejects an unsafe uid or assetId rather than building a path from it', () => {
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    expect(writeLockedPreviewDerivative({ uid: '../etc', assetId: 'asset-1', bytes: BYTES, epoch })).toBe(false);
    expect(writeLockedPreviewDerivative({ uid: 'uid-a', assetId: '../etc', bytes: BYTES, epoch })).toBe(false);
  });
});

describe('uid isolation', () => {
  it('never lists another uid\'s previews', () => {
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-1', bytes: BYTES, epoch });
    writeLockedPreviewDerivative({ uid: 'uid-b', assetId: 'asset-2', bytes: BYTES, epoch });

    expect(listLockedPreviewUris('uid-a').every((uri) => uri.includes('uid-a'))).toBe(true);
    expect(listLockedPreviewUris('uid-b').every((uri) => uri.includes('uid-b'))).toBe(true);
    expect(listLockedPreviewUris('uid-a')).toHaveLength(1);
    expect(listLockedPreviewUris('uid-b')).toHaveLength(1);
  });

  it('LRU eviction for one uid never removes another uid\'s previews', () => {
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    // Fill uid-a past the entry ceiling; uid-b gets exactly one entry.
    for (let i = 0; i < MAX_LOCKED_PREVIEW_ENTRIES + 5; i += 1) {
      writeLockedPreviewDerivative({ uid: 'uid-a', assetId: `asset-${i}`, bytes: BYTES, epoch });
    }
    writeLockedPreviewDerivative({ uid: 'uid-b', assetId: 'keep-me', bytes: BYTES, epoch });

    expect(listLockedPreviewUris('uid-a').length).toBeLessThanOrEqual(MAX_LOCKED_PREVIEW_ENTRIES);
    const uidB = listLockedPreviewUris('uid-b');
    expect(uidB).toHaveLength(1);
    expect(uidB[0]).toContain('keep-me');
  });

  it('pruning except one uid deletes every other uid\'s directory, never the kept one', () => {
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-1', bytes: BYTES, epoch });
    writeLockedPreviewDerivative({ uid: 'uid-b', assetId: 'asset-2', bytes: BYTES, epoch });
    writeLockedPreviewDerivative({ uid: 'uid-c', assetId: 'asset-3', bytes: BYTES, epoch });

    pruneLockedPreviewDerivativesExcept('uid-b');

    expect(listLockedPreviewUris('uid-a')).toHaveLength(0);
    expect(listLockedPreviewUris('uid-c')).toHaveLength(0);
    expect(listLockedPreviewUris('uid-b')).toHaveLength(1);
  });

  it('pruning with null (logout) keeps nothing', () => {
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-1', bytes: BYTES, epoch });

    pruneLockedPreviewDerivativesExcept(null);

    expect(listLockedPreviewUris('uid-a')).toHaveLength(0);
  });

  it('account deletion removes only the named uid, independent of the epoch', () => {
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-1', bytes: BYTES, epoch });
    writeLockedPreviewDerivative({ uid: 'uid-b', assetId: 'asset-2', bytes: BYTES, epoch });

    removeLockedPreviewDerivativesForUser('uid-a');

    expect(listLockedPreviewUris('uid-a')).toHaveLength(0);
    expect(listLockedPreviewUris('uid-b')).toHaveLength(1);
  });
});

describe('LRU limits', () => {
  it('evicts the oldest entries once the entry ceiling is exceeded', () => {
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    for (let i = 0; i < MAX_LOCKED_PREVIEW_ENTRIES + 1; i += 1) {
      writeLockedPreviewDerivative({ uid: 'uid-a', assetId: `asset-${i}`, bytes: BYTES, epoch });
    }
    const stats = photoVaultLockedPreviewCacheStats('uid-a');
    expect(stats.entries).toBeLessThanOrEqual(MAX_LOCKED_PREVIEW_ENTRIES);
  });

  it('evicts once the byte ceiling is exceeded', () => {
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    const big = new Uint8Array(MAX_LOCKED_PREVIEW_BYTES / 2 + 1);
    writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-1', bytes: big, epoch });
    writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-2', bytes: big, epoch });
    writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-3', bytes: big, epoch });

    const stats = photoVaultLockedPreviewCacheStats('uid-a');
    expect(stats.bytes).toBeLessThanOrEqual(MAX_LOCKED_PREVIEW_BYTES);
  });
});

describe('removeLockedPreviewDerivative', () => {
  it('invalidates a single asset, e.g. after delete or replace', () => {
    const epoch = currentPhotoVaultLockedPreviewEpoch();
    writeLockedPreviewDerivative({ uid: 'uid-a', assetId: 'asset-1', bytes: BYTES, epoch });
    removeLockedPreviewDerivative('uid-a', 'asset-1');
    expect(hasLockedPreviewDerivative('uid-a', 'asset-1')).toBe(false);
  });
});

describe('the cache never touches the vault key, crypto or Firebase', () => {
  it('has no such imports or calls', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/photoVaultLockedPreviewCache.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toContain('vaultKey');
    expect(source).not.toContain('photoVaultCrypto');
    expect(source).not.toContain('decrypt');
    expect(source).not.toContain('firebase');
  });

  it('lives under the reclaimable cache directory, never durable app storage', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/photoVaultLockedPreviewCache.ts', 'utf8');
    expect(source).toContain('Paths.cache');
    expect(source).not.toContain('Paths.document');
  });
});
