import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lifecycle contract between the temporary-file sweeps and the persistent
 * encrypted cache.
 *
 * Both modules are exercised against ONE filesystem here on purpose. The whole
 * point of the phase is that a lock or a cold start destroys every plaintext
 * representation while leaving `.thumb.enc` alone, and that only holds if the
 * two sets of directories really are disjoint.
 */
const fs = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; mtime: number }>(),
  dirs: new Set<string>(),
  uuid: 0,
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${(fs.uuid += 1)}` }));

vi.mock('expo-file-system', () => {
  const join = (...parts: string[]) => {
    const joined = parts.join('/');
    const match = joined.match(/^(file:\/\/)(.*)$/);
    return match ? `${match[1]}${match[2].replace(/\/+/g, '/')}` : joined.replace(/\/+/g, '/');
  };

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
      fs.files.set(this.uri, { bytes: new Uint8Array(bytes), mtime: Date.now() });
    }
    moveSync(target: File | Directory) {
      const entry = fs.files.get(this.uri);
      if (!entry) throw new Error('ENOENT');
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

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { cleanupPhotoVaultTempFiles } from '../photoVaultFileCrypto';
import {
  currentPhotoVaultCacheEpoch,
  readCachedThumbnail,
  resetPhotoVaultEncryptedCacheForTesting,
  writeCachedThumbnail,
} from '../photoVaultEncryptedCache';

const UID = 'alice';
const CACHE = 'file:///cache/photo-vault/encrypted-thumbnails';
const TMP = 'file:///cache/photo-vault/tmp';
const ENC = 'file:///cache/photo-vault/enc';

function envelope(size = 64): Uint8Array {
  return new Uint8Array(size).fill(5);
}

/** Plaintext and staging exactly as the existing pipeline leaves them. */
function seedTemporaries(): void {
  fs.dirs.add(TMP);
  fs.dirs.add(ENC);
  fs.files.set(`${TMP}/thumb.jpg`, { bytes: envelope(200), mtime: Date.now() });
  fs.files.set(`${TMP}/full.jpg`, { bytes: envelope(900), mtime: Date.now() });
  fs.files.set(`${ENC}/staging.enc`, { bytes: envelope(300), mtime: Date.now() });
}

beforeEach(() => {
  fs.files.clear();
  fs.dirs.clear();
  fs.uuid = 0;
  resetPhotoVaultEncryptedCacheForTesting();
});

describe('lock', () => {
  it('destroys plaintext and keeps the encrypted thumbnail cache', () => {
    seedTemporaries();
    writeCachedThumbnail({
      uid: UID,
      photoId: 'p1',
      bytes: envelope(),
      epoch: currentPhotoVaultCacheEpoch(),
    });

    // What `lockPhotoVault` runs.
    cleanupPhotoVaultTempFiles();

    expect(fs.files.has(`${TMP}/thumb.jpg`)).toBe(false);
    expect(fs.files.has(`${TMP}/full.jpg`)).toBe(false);
    // Ciphertext staging survives a lock because an upload may be in flight.
    expect(fs.files.has(`${ENC}/staging.enc`)).toBe(true);
    expect(fs.files.has(`${CACHE}/${UID}/p1.thumb.enc`)).toBe(true);
  });
});

describe('cold start', () => {
  it('sweeps both temporary directories without touching the cache', async () => {
    seedTemporaries();
    writeCachedThumbnail({
      uid: UID,
      photoId: 'p1',
      bytes: envelope(),
      epoch: currentPhotoVaultCacheEpoch(),
    });

    // What `App.tsx` runs on bootstrap. This is the sweep the phase had to
    // stay clear of: it is the most aggressive one in the app.
    cleanupPhotoVaultTempFiles({ includeEncrypted: true });

    expect(fs.files.has(`${TMP}/thumb.jpg`)).toBe(false);
    expect(fs.files.has(`${ENC}/staging.enc`)).toBe(false);
    expect(fs.files.has(`${CACHE}/${UID}/p1.thumb.enc`)).toBe(true);
  });

  it('serves the surviving entry after in-memory state is gone', async () => {
    writeCachedThumbnail({
      uid: UID,
      photoId: 'p1',
      bytes: envelope(),
      epoch: currentPhotoVaultCacheEpoch(),
    });
    cleanupPhotoVaultTempFiles({ includeEncrypted: true });

    // Simulate the new process: every module-level map starts empty.
    resetPhotoVaultEncryptedCacheForTesting();

    const read = await readCachedThumbnail({ uid: UID, photoId: 'p1', expectedSize: 64 });
    expect(read).not.toBeNull();
    expect(read!.length).toBe(64);
  });
});

describe('offline', () => {
  it('can still produce ciphertext for a previously cached photo', async () => {
    writeCachedThumbnail({
      uid: UID,
      photoId: 'cached',
      bytes: envelope(),
      epoch: currentPhotoVaultCacheEpoch(),
    });

    // No network is involved in a read: the entry is local by construction.
    expect(await readCachedThumbnail({ uid: UID, photoId: 'cached', expectedSize: 64 })).not.toBeNull();
    // A photo never cached stays unavailable offline, as before this phase.
    expect(await readCachedThumbnail({ uid: UID, photoId: 'never', expectedSize: 64 })).toBeNull();
  });
});

describe('no plaintext is persisted', () => {
  it('leaves no decodable image file anywhere under the vault after a lock', () => {
    seedTemporaries();
    writeCachedThumbnail({
      uid: UID,
      photoId: 'p1',
      bytes: envelope(),
      epoch: currentPhotoVaultCacheEpoch(),
    });

    cleanupPhotoVaultTempFiles();

    const survivors = [...fs.files.keys()];
    for (const uri of survivors) {
      expect(uri).not.toMatch(/\.(jpg|jpeg|png|webp)$/);
    }
    // Only ciphertext remains: the cached envelope and the upload staging.
    expect(survivors.every((uri) => uri.endsWith('.enc'))).toBe(true);
  });
});
