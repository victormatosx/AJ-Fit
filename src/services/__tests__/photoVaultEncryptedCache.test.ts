import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory filesystem mirroring the parts of the expo-file-system 56 API the
 * encrypted cache uses. Modification times are explicit so eviction ordering
 * and the throttled touch can be exercised without real clocks.
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
  const join = (...parts: string[]) => {
    const joined = parts.join('/');
    const match = joined.match(/^(file:\/\/)(.*)$/);
    return match ? `${match[1]}${match[2].replace(/\/+/g, '/')}` : joined.replace(/\/+/g, '/');
  };

  /** Immediate children only, so `list()` matches the real shallow listing. */
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
      if (fs.files.has(target.uri) && !options?.overwrite) throw new Error('EEXIST');
      fs.files.delete(this.uri);
      fs.files.set(target.uri, { bytes: entry.bytes, mtime: Date.now() });
      this.uri = target.uri;
    }
    delete() {
      if (!fs.files.has(this.uri)) throw new Error('ENOENT');
      fs.files.delete(this.uri);
    }
  }

  return { Directory, File, Paths: { cache: new Directory('file:///cache') } };
});

import {
  MAX_CACHE_BYTES,
  MAX_CACHE_ENTRIES,
  MAX_FULL_CIPHER_CACHE_BYTES,
  MAX_FULL_CIPHER_CACHE_ENTRIES,
  TOUCH_MIN_INTERVAL_MS,
  currentPhotoVaultCacheEpoch,
  enforceCacheLimits,
  enforceFullCacheLimits,
  photoVaultCacheStats,
  photoVaultFullCacheStats,
  prunePhotoVaultCiphertextExcept,
  readCachedFull,
  readCachedThumbnail,
  reconcileCachedFulls,
  reconcileCachedThumbnails,
  removeCachedFull,
  removeCachedThumbnail,
  removePhotoVaultCiphertextForUser,
  resetPhotoVaultEncryptedCacheForTesting,
  writeCachedFull,
  writeCachedThumbnail,
} from '../photoVaultEncryptedCache';

const UID = 'alice';
const OTHER_UID = 'mallory';
const ROOT = 'file:///cache/photo-vault/encrypted-thumbnails';
const FULL_ROOT = 'file:///cache/photo-vault/encrypted-fulls';

function envelope(size = 64, fill = 7): Uint8Array {
  return new Uint8Array(size).fill(fill);
}

function pathFor(uid: string, photoId: string): string {
  return `${ROOT}/${uid}/${photoId}.thumb.enc`;
}

function fullPathFor(uid: string, photoId: string): string {
  return `${FULL_ROOT}/${uid}/${photoId}.full.enc`;
}

function seed(uid: string, photoId: string, size = 64, mtime = Date.now()): void {
  fs.dirs.add(`${ROOT}/${uid}`);
  fs.files.set(pathFor(uid, photoId), { bytes: envelope(size), mtime });
}

function seedFull(uid: string, photoId: string, size = 4096, mtime = Date.now()): void {
  fs.dirs.add(`${FULL_ROOT}/${uid}`);
  fs.files.set(fullPathFor(uid, photoId), { bytes: envelope(size), mtime });
}

function epoch(): number {
  return currentPhotoVaultCacheEpoch();
}

beforeEach(() => {
  fs.files.clear();
  fs.dirs.clear();
  fs.failWrite = false;
  fs.failMove = false;
  fs.uuid = 0;
  resetPhotoVaultEncryptedCacheForTesting();
});

describe('cache directory placement', () => {
  it('lives in a namespace outside the directories the startup sweep clears', () => {
    writeCachedThumbnail({ uid: UID, photoId: 'p1', bytes: envelope(), epoch: epoch() });

    const stored = [...fs.files.keys()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toBe(pathFor(UID, 'p1'));
    // `cleanupPhotoVaultTempFiles` lists `tmp` and `enc` by name. Being a
    // sibling is what makes the cache survive a cold start.
    expect(stored[0]).not.toContain('/photo-vault/tmp/');
    expect(stored[0]).not.toContain('/photo-vault/enc/');
  });

  it('namespaces every entry by uid', () => {
    writeCachedThumbnail({ uid: UID, photoId: 'shared', bytes: envelope(), epoch: epoch() });
    writeCachedThumbnail({ uid: OTHER_UID, photoId: 'shared', bytes: envelope(32), epoch: epoch() });

    expect(fs.files.has(pathFor(UID, 'shared'))).toBe(true);
    expect(fs.files.has(pathFor(OTHER_UID, 'shared'))).toBe(true);
    expect(fs.files.size).toBe(2);
  });

  it('refuses identifiers that could escape the namespace', () => {
    expect(
      writeCachedThumbnail({ uid: '../../etc', photoId: 'p1', bytes: envelope(), epoch: epoch() }),
    ).toBe(false);
    expect(
      writeCachedThumbnail({ uid: UID, photoId: '../../../evil', bytes: envelope(), epoch: epoch() }),
    ).toBe(false);
    expect(fs.files.size).toBe(0);
  });
});

describe('read and write', () => {
  it('returns null on a miss without creating anything', async () => {
    expect(await readCachedThumbnail({ uid: UID, photoId: 'absent', expectedSize: 64 })).toBeNull();
    expect(fs.files.size).toBe(0);
  });

  it('returns the exact ciphertext on a hit', async () => {
    const bytes = envelope(64, 9);
    writeCachedThumbnail({ uid: UID, photoId: 'p1', bytes, epoch: epoch() });

    const read = await readCachedThumbnail({ uid: UID, photoId: 'p1', expectedSize: 64 });
    expect(read).not.toBeNull();
    expect([...read!]).toEqual([...bytes]);
  });

  it('never writes the final name until the content is complete', () => {
    fs.failMove = true;
    expect(
      writeCachedThumbnail({ uid: UID, photoId: 'p1', bytes: envelope(), epoch: epoch() }),
    ).toBe(false);

    // The temporary must not survive, and the real name must never exist.
    expect(fs.files.has(pathFor(UID, 'p1'))).toBe(false);
    expect([...fs.files.keys()].filter((uri) => uri.includes('.tmp-'))).toHaveLength(0);
  });

  it('reports a failed write instead of throwing, so the photo still renders', () => {
    fs.failWrite = true;
    expect(
      writeCachedThumbnail({ uid: UID, photoId: 'p1', bytes: envelope(), epoch: epoch() }),
    ).toBe(false);
  });

  it('treats a wrong-sized entry as a miss and drops it', async () => {
    seed(UID, 'p1', 64);
    expect(await readCachedThumbnail({ uid: UID, photoId: 'p1', expectedSize: 128 })).toBeNull();
    expect(fs.files.has(pathFor(UID, 'p1'))).toBe(false);
  });

  it('treats a truncated entry as a miss and drops it', async () => {
    seed(UID, 'p1', 10);
    expect(await readCachedThumbnail({ uid: UID, photoId: 'p1', expectedSize: 64 })).toBeNull();
    expect(fs.files.has(pathFor(UID, 'p1'))).toBe(false);
  });

  it('sweeps a temporary abandoned by a crash instead of serving it', () => {
    fs.dirs.add(`${ROOT}/${UID}`);
    fs.files.set(`${ROOT}/${UID}/.tmp-orphan`, { bytes: envelope(), mtime: Date.now() });
    seed(UID, 'p1');

    expect(photoVaultCacheStats(UID).entries).toBe(1);
    expect(fs.files.has(`${ROOT}/${UID}/.tmp-orphan`)).toBe(false);
  });
});

describe('invalidation', () => {
  it('removes a single photo', () => {
    writeCachedThumbnail({ uid: UID, photoId: 'p1', bytes: envelope(), epoch: epoch() });
    writeCachedThumbnail({ uid: UID, photoId: 'p2', bytes: envelope(), epoch: epoch() });

    removeCachedThumbnail(UID, 'p1');
    expect(fs.files.has(pathFor(UID, 'p1'))).toBe(false);
    expect(fs.files.has(pathFor(UID, 'p2'))).toBe(true);
  });

  it('removes everything for one user and leaves other namespaces alone', () => {
    writeCachedThumbnail({ uid: UID, photoId: 'p1', bytes: envelope(), epoch: epoch() });
    writeCachedThumbnail({ uid: OTHER_UID, photoId: 'p1', bytes: envelope(), epoch: epoch() });

    removePhotoVaultCiphertextForUser(UID);
    expect(fs.files.has(pathFor(UID, 'p1'))).toBe(false);
    expect(fs.files.has(pathFor(OTHER_UID, 'p1'))).toBe(true);
  });

  it('removes BOTH ciphertext kinds for one user', () => {
    writeCachedThumbnail({ uid: UID, photoId: 'p1', bytes: envelope(), epoch: epoch() });
    writeCachedFull({ uid: UID, photoId: 'p1', bytes: envelope(4096), epoch: epoch() });

    removePhotoVaultCiphertextForUser(UID);
    expect(fs.files.has(pathFor(UID, 'p1'))).toBe(false);
    expect(fs.files.has(fullPathFor(UID, 'p1'))).toBe(false);
  });

  it('keeps only the signed-in namespace', () => {
    writeCachedThumbnail({ uid: UID, photoId: 'p1', bytes: envelope(), epoch: epoch() });
    writeCachedThumbnail({ uid: OTHER_UID, photoId: 'p1', bytes: envelope(), epoch: epoch() });

    prunePhotoVaultCiphertextExcept(UID);
    expect(fs.files.has(pathFor(UID, 'p1'))).toBe(true);
    expect(fs.files.has(pathFor(OTHER_UID, 'p1'))).toBe(false);
  });

  it('prunes the full ciphertext of every other identity too', () => {
    writeCachedFull({ uid: UID, photoId: 'p1', bytes: envelope(4096), epoch: epoch() });
    writeCachedFull({ uid: OTHER_UID, photoId: 'p1', bytes: envelope(4096), epoch: epoch() });

    prunePhotoVaultCiphertextExcept(UID);
    expect(fs.files.has(fullPathFor(UID, 'p1'))).toBe(true);
    // A full another account left behind must never be readable by this one.
    expect(fs.files.has(fullPathFor(OTHER_UID, 'p1'))).toBe(false);
  });

  it('keeps nothing on logout', () => {
    writeCachedThumbnail({ uid: UID, photoId: 'p1', bytes: envelope(), epoch: epoch() });
    writeCachedThumbnail({ uid: OTHER_UID, photoId: 'p1', bytes: envelope(), epoch: epoch() });
    writeCachedFull({ uid: UID, photoId: 'p1', bytes: envelope(4096), epoch: epoch() });

    prunePhotoVaultCiphertextExcept(null);
    expect(fs.files.size).toBe(0);
  });

  it('drops entries whose photo no longer exists remotely', () => {
    writeCachedThumbnail({ uid: UID, photoId: 'kept', bytes: envelope(), epoch: epoch() });
    writeCachedThumbnail({ uid: UID, photoId: 'gone', bytes: envelope(), epoch: epoch() });

    expect(reconcileCachedThumbnails(UID, ['kept'])).toBe(1);
    expect(fs.files.has(pathFor(UID, 'kept'))).toBe(true);
    expect(fs.files.has(pathFor(UID, 'gone'))).toBe(false);
  });

  it('bounds how much one reconciliation removes', () => {
    for (let index = 0; index < 10; index += 1) {
      writeCachedThumbnail({ uid: UID, photoId: `p${index}`, bytes: envelope(), epoch: epoch() });
    }
    expect(reconcileCachedThumbnails(UID, [], 4)).toBe(4);
    expect(photoVaultCacheStats(UID).entries).toBe(6);
  });
});

describe('identity race', () => {
  it('refuses a write carrying an epoch from a cleared session', () => {
    // Captured by an operation that started before the identity change.
    const captured = epoch();
    prunePhotoVaultCiphertextExcept(null);

    expect(
      writeCachedThumbnail({ uid: UID, photoId: 'late', bytes: envelope(), epoch: captured }),
    ).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it('refuses a late FULL write carrying an epoch from a cleared session', () => {
    const captured = epoch();
    prunePhotoVaultCiphertextExcept(null);

    expect(
      writeCachedFull({ uid: UID, photoId: 'late', bytes: envelope(4096), epoch: captured }),
    ).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it('accepts a write started after the identity change', () => {
    prunePhotoVaultCiphertextExcept(UID);
    expect(
      writeCachedThumbnail({ uid: UID, photoId: 'fresh', bytes: envelope(), epoch: epoch() }),
    ).toBe(true);
  });
});

/**
 * The full ciphertext cache.
 *
 * Same module, same invariants, a second namespace: envelopes are ciphertext
 * either way, so what differs is only the size class they are budgeted for.
 */
describe('full ciphertext cache', () => {
  it('lives in its own namespace, outside the directories the startup sweep clears', () => {
    writeCachedFull({ uid: UID, photoId: 'p1', bytes: envelope(4096), epoch: epoch() });

    const stored = [...fs.files.keys()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toBe(fullPathFor(UID, 'p1'));
    expect(stored[0]).not.toContain('/photo-vault/tmp/');
    expect(stored[0]).not.toContain('/photo-vault/enc/');
  });

  it('never collides with the thumbnail entry of the same photo', () => {
    writeCachedThumbnail({ uid: UID, photoId: 'same', bytes: envelope(64), epoch: epoch() });
    writeCachedFull({ uid: UID, photoId: 'same', bytes: envelope(4096), epoch: epoch() });

    expect(fs.files.get(pathFor(UID, 'same'))!.bytes.length).toBe(64);
    expect(fs.files.get(fullPathFor(UID, 'same'))!.bytes.length).toBe(4096);
  });

  it('namespaces every entry by uid', () => {
    writeCachedFull({ uid: UID, photoId: 'shared', bytes: envelope(4096), epoch: epoch() });
    writeCachedFull({ uid: OTHER_UID, photoId: 'shared', bytes: envelope(2048), epoch: epoch() });

    expect(fs.files.get(fullPathFor(UID, 'shared'))!.bytes.length).toBe(4096);
    expect(fs.files.get(fullPathFor(OTHER_UID, 'shared'))!.bytes.length).toBe(2048);
  });

  it('refuses identifiers that could escape the namespace', () => {
    expect(
      writeCachedFull({ uid: '../../etc', photoId: 'p1', bytes: envelope(4096), epoch: epoch() }),
    ).toBe(false);
    expect(
      writeCachedFull({ uid: UID, photoId: '../../evil', bytes: envelope(4096), epoch: epoch() }),
    ).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it('returns null on a miss without creating anything', async () => {
    expect(await readCachedFull({ uid: UID, photoId: 'absent', expectedSize: 4096 })).toBeNull();
    expect(fs.files.size).toBe(0);
  });

  it('returns the exact ciphertext on a hit', async () => {
    const bytes = envelope(4096, 3);
    writeCachedFull({ uid: UID, photoId: 'p1', bytes, epoch: epoch() });

    const read = await readCachedFull({ uid: UID, photoId: 'p1', expectedSize: 4096 });
    expect(read).not.toBeNull();
    expect([...read!]).toEqual([...bytes]);
  });

  it('treats a truncated entry as a miss and drops it', async () => {
    seedFull(UID, 'p1', 100);
    expect(await readCachedFull({ uid: UID, photoId: 'p1', expectedSize: 4096 })).toBeNull();
    expect(fs.files.has(fullPathFor(UID, 'p1'))).toBe(false);
  });

  it('never writes the final name until the content is complete', () => {
    fs.failMove = true;
    expect(
      writeCachedFull({ uid: UID, photoId: 'p1', bytes: envelope(4096), epoch: epoch() }),
    ).toBe(false);

    expect(fs.files.has(fullPathFor(UID, 'p1'))).toBe(false);
    expect([...fs.files.keys()].filter((uri) => uri.includes('.tmp-'))).toHaveLength(0);
  });

  it('removes a single full', () => {
    writeCachedFull({ uid: UID, photoId: 'p1', bytes: envelope(4096), epoch: epoch() });
    writeCachedFull({ uid: UID, photoId: 'p2', bytes: envelope(4096), epoch: epoch() });

    removeCachedFull(UID, 'p1');
    expect(fs.files.has(fullPathFor(UID, 'p1'))).toBe(false);
    expect(fs.files.has(fullPathFor(UID, 'p2'))).toBe(true);
  });

  it('drops entries whose photo no longer exists remotely', () => {
    writeCachedFull({ uid: UID, photoId: 'kept', bytes: envelope(4096), epoch: epoch() });
    writeCachedFull({ uid: UID, photoId: 'gone', bytes: envelope(4096), epoch: epoch() });

    expect(reconcileCachedFulls(UID, ['kept'])).toBe(1);
    expect(fs.files.has(fullPathFor(UID, 'kept'))).toBe(true);
    expect(fs.files.has(fullPathFor(UID, 'gone'))).toBe(false);
  });

  it('budgets bytes conservatively rather than by count alone', () => {
    // A full envelope is up to MAX_ENCRYPTED_BYTES (10 MiB), so a count-only
    // ceiling could not bound this cache at all.
    expect(MAX_FULL_CIPHER_CACHE_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_FULL_CIPHER_CACHE_ENTRIES).toBe(120);
  });

  it('evicts the least recently used full once the byte ceiling is passed', () => {
    const now = Date.now();
    const big = Math.floor(MAX_FULL_CIPHER_CACHE_BYTES / 2);
    seedFull(UID, 'old', big, now - 10_000);
    seedFull(UID, 'new', big, now);
    seedFull(UID, 'newest', 4096, now + 10_000);

    expect(enforceFullCacheLimits(UID)).toBe(1);
    expect(fs.files.has(fullPathFor(UID, 'old'))).toBe(false);
    expect(photoVaultFullCacheStats(UID).bytes).toBeLessThanOrEqual(MAX_FULL_CIPHER_CACHE_BYTES);
  });

  it('enforces its budget on write, so one huge photo cannot evict the world', () => {
    const now = Date.now();
    seedFull(UID, 'old', Math.floor(MAX_FULL_CIPHER_CACHE_BYTES * 0.9), now - 10_000);

    writeCachedFull({
      uid: UID,
      photoId: 'fresh',
      bytes: envelope(Math.floor(MAX_FULL_CIPHER_CACHE_BYTES * 0.5)),
      epoch: epoch(),
    });

    expect(fs.files.has(fullPathFor(UID, 'fresh'))).toBe(true);
    expect(fs.files.has(fullPathFor(UID, 'old'))).toBe(false);
  });

  it('reports aggregates only', () => {
    writeCachedFull({ uid: UID, photoId: 'p1', bytes: envelope(4096), epoch: epoch() });
    expect(photoVaultFullCacheStats(UID)).toEqual({ entries: 1, bytes: 4096 });
  });

  it('stores envelopes under a derived name and nothing else', () => {
    writeCachedFull({ uid: UID, photoId: 'p1', bytes: envelope(4096), epoch: epoch() });

    for (const uri of fs.files.keys()) {
      expect(uri.endsWith('.full.enc')).toBe(true);
      expect(uri).not.toMatch(/\.(jpg|jpeg|png|webp)$/);
    }
    expect(fs.files.size).toBe(1);
  });
});

describe('limits and eviction', () => {
  it('exposes a byte budget well under a hundred megabytes', () => {
    expect(MAX_CACHE_BYTES).toBe(24 * 1024 * 1024);
    expect(MAX_CACHE_ENTRIES).toBe(300);
  });

  it('evicts the least recently used entry once the count ceiling is passed', () => {
    const now = Date.now();
    for (let index = 0; index < MAX_CACHE_ENTRIES + 1; index += 1) {
      // Oldest first, so `p0` is the eviction candidate.
      seed(UID, `p${index}`, 64, now - (MAX_CACHE_ENTRIES + 1 - index) * 1000);
    }

    expect(enforceCacheLimits(UID)).toBe(1);
    expect(fs.files.has(pathFor(UID, 'p0'))).toBe(false);
    expect(photoVaultCacheStats(UID).entries).toBe(MAX_CACHE_ENTRIES);
  });

  it('evicts by bytes when few large entries pass the byte ceiling', () => {
    const now = Date.now();
    const big = Math.floor(MAX_CACHE_BYTES / 2);
    seed(UID, 'old', big, now - 10_000);
    seed(UID, 'new', big, now);
    seed(UID, 'newest', 1024, now + 10_000);

    expect(enforceCacheLimits(UID)).toBe(1);
    expect(fs.files.has(pathFor(UID, 'old'))).toBe(false);
    expect(photoVaultCacheStats(UID).bytes).toBeLessThanOrEqual(MAX_CACHE_BYTES);
  });

  it('does nothing while both ceilings are satisfied', () => {
    seed(UID, 'p1');
    expect(enforceCacheLimits(UID)).toBe(0);
    expect(photoVaultCacheStats(UID).entries).toBe(1);
  });
});

describe('recency across a restart', () => {
  it('refreshes the stored modification time when a stale entry is hit', async () => {
    const stale = Date.now() - TOUCH_MIN_INTERVAL_MS - 1000;
    seed(UID, 'p1', 64, stale);

    await readCachedThumbnail({ uid: UID, photoId: 'p1', expectedSize: 64 });

    // Reading a file does not update its modification time, so without the
    // touch a daily-opened photo would be evicted before one never reopened.
    expect(fs.files.get(pathFor(UID, 'p1'))!.mtime).toBeGreaterThan(stale);
  });

  it('does not rewrite a recently touched entry on every hit', async () => {
    const fresh = Date.now() - 1000;
    seed(UID, 'p1', 64, fresh);

    await readCachedThumbnail({ uid: UID, photoId: 'p1', expectedSize: 64 });
    await readCachedThumbnail({ uid: UID, photoId: 'p1', expectedSize: 64 });

    expect(fs.files.get(pathFor(UID, 'p1'))!.mtime).toBe(fresh);
  });

  it('evicts by hit order, not insertion order, after in-memory state is lost', async () => {
    const now = Date.now();
    // `a` is written first, so insertion order alone would evict it first.
    seed(UID, 'a', 64, now - TOUCH_MIN_INTERVAL_MS - 3000);
    seed(UID, 'b', 64, now - TOUCH_MIN_INTERVAL_MS - 2000);

    // `a` is the one the user keeps opening; `b` is never reopened.
    await readCachedThumbnail({ uid: UID, photoId: 'a', expectedSize: 64 });

    // Simulate a process restart: the session access map is gone and only what
    // is on disk can inform eviction.
    resetPhotoVaultEncryptedCacheForTesting();

    // One entry past the count ceiling, all newer than `a` and `b`, so exactly
    // one eviction happens and it has to choose between them.
    for (let index = 0; index < MAX_CACHE_ENTRIES - 1; index += 1) {
      seed(UID, `filler${index}`, 64, now + index);
    }

    expect(enforceCacheLimits(UID)).toBe(1);
    expect(fs.files.has(pathFor(UID, 'b'))).toBe(false);
    expect(fs.files.has(pathFor(UID, 'a'))).toBe(true);
  });
});

describe('privacy of what is stored', () => {
  it('stores ciphertext under a derived name and nothing else', () => {
    writeCachedThumbnail({ uid: UID, photoId: 'p1', bytes: envelope(), epoch: epoch() });

    for (const uri of fs.files.keys()) {
      expect(uri.endsWith('.thumb.enc')).toBe(true);
      expect(uri).not.toMatch(/\.(jpg|jpeg|png|webp)$/);
    }
    // No sidecar index, no metadata file — the directory holds envelopes only.
    expect(fs.files.size).toBe(1);
  });

  it('reports aggregates only', () => {
    writeCachedThumbnail({ uid: UID, photoId: 'p1', bytes: envelope(64), epoch: epoch() });
    expect(photoVaultCacheStats(UID)).toEqual({ entries: 1, bytes: 64 });
  });
});
