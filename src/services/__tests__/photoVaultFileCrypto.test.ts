import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Real AES-256-GCM via Node, as in lib/__tests__/photoVaultCrypto.test.ts. */
vi.mock('expo-crypto', async () => {
  const nodeCrypto = await import('node:crypto');

  class AESEncryptionKey {
    constructor(
      readonly raw: Buffer,
      readonly size: number,
    ) {}
    static async import(value: string, encoding: 'base64' | 'hex') {
      const raw = Buffer.from(value, encoding);
      if (![16, 24, 32].includes(raw.length)) throw new Error('bad key size');
      return new AESEncryptionKey(raw, raw.length * 8);
    }
  }

  class AESSealedData {
    constructor(
      private readonly _iv: Uint8Array,
      private readonly _ct: Uint8Array,
      private readonly _tag: Uint8Array,
    ) {}
    static fromParts(iv: Uint8Array, ct: Uint8Array, tag: Uint8Array) {
      return new AESSealedData(iv, ct, tag);
    }
    async iv() {
      return this._iv;
    }
    async tag() {
      return this._tag;
    }
    async ciphertext() {
      return this._ct;
    }
  }

  return {
    AESKeySize: { AES128: 128, AES192: 192, AES256: 256 },
    AESEncryptionKey,
    AESSealedData,
    async aesEncryptAsync(plaintext: Uint8Array, key: AESEncryptionKey) {
      const iv = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key.raw, iv);
      const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return new AESSealedData(iv, ct, cipher.getAuthTag());
    },
    async aesDecryptAsync(sealed: AESSealedData, key: AESEncryptionKey) {
      const d = nodeCrypto.createDecipheriv('aes-256-gcm', key.raw, await sealed.iv());
      d.setAuthTag(Buffer.from(await sealed.tag()));
      return new Uint8Array(
        Buffer.concat([d.update(Buffer.from(await sealed.ciphertext())), d.final()]),
      );
    },
    randomUUID: () => nodeCrypto.randomUUID(),
  };
});

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

/** Minimal in-memory filesystem mirroring the expo-file-system API surface. */
const fs = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  dirs: new Set<string>(),
  failWrite: false,
}));

vi.mock('expo-file-system', () => {
  // Collapses duplicate slashes in the path while preserving the `file://`
  // scheme prefix (so `file:///cache` does not become `file://cache`).
  const join = (...parts: string[]) => {
    const joined = parts.join('/');
    const match = joined.match(/^(file:\/\/)(.*)$/);
    return match
      ? `${match[1]}${match[2].replace(/\/+/g, '/')}`
      : joined.replace(/\/+/g, '/');
  };

  class Directory {
    uri: string;
    constructor(...parts: (string | Directory)[]) {
      this.uri = join(...parts.map((p) => (typeof p === 'string' ? p : p.uri)));
    }
    create() {
      fs.dirs.add(this.uri);
    }
    get exists() {
      return fs.dirs.has(this.uri);
    }
    list() {
      return [...fs.files.keys()]
        .filter((uri) => uri.startsWith(`${this.uri}/`))
        .map((uri) => new File(uri));
    }
    delete() {
      fs.dirs.delete(this.uri);
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
      return fs.files.get(this.uri)?.length ?? null;
    }
    async bytes() {
      const data = fs.files.get(this.uri);
      if (!data) throw new Error('ENOENT');
      // expo-file-system returns a new owned buffer. Keeping the Map's
      // reference here would make secure zeroing mutate the persisted file.
      return new Uint8Array(data);
    }
    write(bytes: Uint8Array) {
      if (fs.failWrite) throw new Error('EIO');
      fs.files.set(this.uri, new Uint8Array(bytes));
    }
    async copy(target: File) {
      if (fs.failWrite) throw new Error('EIO');
      const data = fs.files.get(this.uri);
      if (!data) throw new Error('ENOENT');
      fs.files.set(target.uri, new Uint8Array(data));
    }
    delete() {
      if (!fs.files.has(this.uri)) throw new Error('ENOENT');
      fs.files.delete(this.uri);
    }
  }

  return { Directory, File, Paths: { cache: new Directory('file:///cache') } };
});

import { randomBytes } from 'node:crypto';

import { HEADER_BYTES } from '../../lib/photoVaultCrypto';
import {
  cleanupPhotoVaultShareFiles,
  cleanupPhotoVaultTempFiles,
  createPhotoVaultShareFilePath,
  decryptPhotoFile,
  discardDecryptedPhoto,
  discardEncryptedPhoto,
  discardPhotoVaultPickerOutput,
  discardPhotoVaultShareFile,
  encryptPhotoFile,
  stagePhotoVaultPlaintext,
} from '../photoVaultFileCrypto';

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');
const SOURCE = 'file:///camera/photo.jpg';

function seedPhoto(size = 4096): Uint8Array {
  const bytes = new Uint8Array(randomBytes(size));
  fs.files.set(SOURCE, bytes);
  return bytes;
}

function issueOf(err: unknown): string {
  return (err as { issue?: string }).issue ?? 'none';
}

beforeEach(() => {
  fs.files.clear();
  fs.dirs.clear();
  fs.failWrite = false;
});

// ── Encryption ─────────────────────────────────────────────────────────────

describe('encryptPhotoFile', () => {
  it('writes a .enc file that is not the original', async () => {
    const original = seedPhoto();

    const result = await encryptPhotoFile({
      sourceUri: SOURCE,
      vaultKeyBase64: KEY,
      vaultKeyVersion: 1,
    });

    expect(result.encryptedUri).toMatch(/\.enc$/);
    const stored = fs.files.get(result.encryptedUri)!;
    expect(Buffer.from(stored)).not.toEqual(Buffer.from(original));
    expect(Buffer.from(stored).includes(Buffer.from(original))).toBe(false);
  });

  it('stores encrypted files under the vault cache subtree', async () => {
    seedPhoto();

    const { encryptedUri } = await encryptPhotoFile({
      sourceUri: SOURCE,
      vaultKeyBase64: KEY,
      vaultKeyVersion: 1,
    });

    expect(encryptedUri).toContain('/cache/photo-vault/enc/');
  });

  it('returns metadata matching the phase 4 Firestore contract', async () => {
    const original = seedPhoto(1000);

    const result = await encryptPhotoFile({
      sourceUri: SOURCE,
      vaultKeyBase64: KEY,
      vaultKeyVersion: 3,
    });

    expect(result.encryptedSize).toBe(1000 + HEADER_BYTES);
    expect(result.encryption).toEqual({
      version: 1,
      algorithm: 'AES-256-GCM',
      iv: expect.any(String),
      vaultKeyVersion: 3,
    });
    expect(Buffer.from(result.encryption.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(original)).toBeDefined();
  });

  it('never returns the vault key', async () => {
    seedPhoto();

    const result = await encryptPhotoFile({
      sourceUri: SOURCE,
      vaultKeyBase64: KEY,
      vaultKeyVersion: 1,
    });

    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('gives every file an unpredictable name', async () => {
    seedPhoto();
    const names = new Set<string>();

    for (let i = 0; i < 5; i += 1) {
      const { encryptedUri } = await encryptPhotoFile({
        sourceUri: SOURCE,
        vaultKeyBase64: KEY,
        vaultKeyVersion: 1,
      });
      names.add(encryptedUri);
    }

    expect(names.size).toBe(5);
  });

  it('fails when the source cannot be read', async () => {
    const err = await encryptPhotoFile({
      sourceUri: 'file:///missing.jpg',
      vaultKeyBase64: KEY,
      vaultKeyVersion: 1,
    }).catch((e: unknown) => e);

    expect(issueOf(err)).toBe('vaultFileReadFailed');
  });

  it('rejects an empty source file', async () => {
    fs.files.set(SOURCE, new Uint8Array(0));

    const err = await encryptPhotoFile({
      sourceUri: SOURCE,
      vaultKeyBase64: KEY,
      vaultKeyVersion: 1,
    }).catch((e: unknown) => e);

    expect(issueOf(err)).toBe('vaultFileReadFailed');
  });

  it('leaves no partial file behind when the write fails', async () => {
    seedPhoto();
    fs.failWrite = true;

    const err = await encryptPhotoFile({
      sourceUri: SOURCE,
      vaultKeyBase64: KEY,
      vaultKeyVersion: 1,
    }).catch((e: unknown) => e);

    expect(issueOf(err)).toBe('vaultFileWriteFailed');
    expect([...fs.files.keys()].filter((u) => u.endsWith('.enc'))).toHaveLength(0);
  });

  it('rejects an invalid vault key before writing anything', async () => {
    seedPhoto();

    const err = await encryptPhotoFile({
      sourceUri: SOURCE,
      vaultKeyBase64: 'not-a-key',
      vaultKeyVersion: 1,
    }).catch((e: unknown) => e);

    expect(issueOf(err)).toBe('vaultCryptoInvalidKey');
    expect([...fs.files.keys()].filter((u) => u.endsWith('.enc'))).toHaveLength(0);
  });
});

// ── Decryption ─────────────────────────────────────────────────────────────

describe('decryptPhotoFile', () => {
  async function encrypted() {
    const original = seedPhoto();
    const { encryptedUri } = await encryptPhotoFile({
      sourceUri: SOURCE,
      vaultKeyBase64: KEY,
      vaultKeyVersion: 1,
    });
    return { original, encryptedUri };
  }

  it('reproduces the original bytes exactly', async () => {
    const { original, encryptedUri } = await encrypted();

    const { uri, size } = await decryptPhotoFile({ encryptedUri, vaultKeyBase64: KEY });

    expect(Buffer.from(fs.files.get(uri)!)).toEqual(Buffer.from(original));
    expect(size).toBe(original.length);
  });

  it('writes plaintext only to the short-lived temp subtree', async () => {
    const { encryptedUri } = await encrypted();

    const { uri } = await decryptPhotoFile({ encryptedUri, vaultKeyBase64: KEY });

    expect(uri).toContain('/cache/photo-vault/tmp/');
    // Never the document directory: plaintext is not durable app data.
    expect(uri).not.toContain('document');
  });

  it('gives the plaintext an unpredictable name', async () => {
    const { encryptedUri } = await encrypted();

    const first = await decryptPhotoFile({ encryptedUri, vaultKeyBase64: KEY });
    const second = await decryptPhotoFile({ encryptedUri, vaultKeyBase64: KEY });

    expect(first.uri).not.toBe(second.uri);
  });

  it('fails with the wrong key and writes no plaintext', async () => {
    const { encryptedUri } = await encrypted();

    const err = await decryptPhotoFile({
      encryptedUri,
      vaultKeyBase64: OTHER_KEY,
    }).catch((e: unknown) => e);

    expect(issueOf(err)).toBe('vaultCryptoIntegrityFailed');
    expect([...fs.files.keys()].filter((u) => u.includes('/tmp/'))).toHaveLength(0);
  });

  it('fails on a tampered file and writes no plaintext', async () => {
    const { encryptedUri } = await encrypted();
    fs.files.get(encryptedUri)![HEADER_BYTES + 5] ^= 0xff;

    const err = await decryptPhotoFile({ encryptedUri, vaultKeyBase64: KEY }).catch(
      (e: unknown) => e,
    );

    expect(issueOf(err)).toBe('vaultCryptoIntegrityFailed');
    expect([...fs.files.keys()].filter((u) => u.includes('/tmp/'))).toHaveLength(0);
  });

  it('fails on a file that is not a vault envelope', async () => {
    fs.files.set('file:///cache/photo-vault/enc/bogus.enc', new Uint8Array(randomBytes(100)));

    const err = await decryptPhotoFile({
      encryptedUri: 'file:///cache/photo-vault/enc/bogus.enc',
      vaultKeyBase64: KEY,
    }).catch((e: unknown) => e);

    expect(issueOf(err)).toBe('vaultCryptoInvalidFile');
  });

  it('fails when the encrypted file is missing', async () => {
    const err = await decryptPhotoFile({
      encryptedUri: 'file:///cache/photo-vault/enc/gone.enc',
      vaultKeyBase64: KEY,
    }).catch((e: unknown) => e);

    expect(issueOf(err)).toBe('vaultFileReadFailed');
  });

  it('honours a requested extension', async () => {
    const { encryptedUri } = await encrypted();

    const { uri } = await decryptPhotoFile({
      encryptedUri,
      vaultKeyBase64: KEY,
      extension: '.png',
    });

    expect(uri).toMatch(/\.png$/);
  });
});

// ── Plaintext lifecycle ────────────────────────────────────────────────────

describe('plaintext lifecycle', () => {
  it('moves a normalized picker output into the controlled temp subtree', async () => {
    const normalized = 'file:///cache/ImageManipulator/normalized.jpg';
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fs.files.set(normalized, bytes);

    const staged = await stagePhotoVaultPlaintext(normalized);

    expect(staged.uri).toContain('/cache/photo-vault/tmp/');
    expect(fs.files.get(staged.uri)).toEqual(bytes);
    expect(fs.files.has(normalized)).toBe(false);
  });

  it('never deletes a rejected picker URI outside the app cache', () => {
    fs.files.set(SOURCE, new Uint8Array([1]));
    fs.files.set('file:///document/owned.jpg', new Uint8Array([2]));

    discardPhotoVaultPickerOutput(SOURCE);
    discardPhotoVaultPickerOutput('file:///document/owned.jpg');

    expect(fs.files.has(SOURCE)).toBe(true);
    expect(fs.files.has('file:///document/owned.jpg')).toBe(true);
  });

  it('can be discarded immediately after use', async () => {
    seedPhoto();
    const { encryptedUri } = await encryptPhotoFile({
      sourceUri: SOURCE,
      vaultKeyBase64: KEY,
      vaultKeyVersion: 1,
    });
    const { uri } = await decryptPhotoFile({ encryptedUri, vaultKeyBase64: KEY });

    discardDecryptedPhoto(uri);

    expect(fs.files.has(uri)).toBe(false);
  });

  it('tolerates discarding a file that is already gone', () => {
    expect(() => discardDecryptedPhoto('file:///cache/photo-vault/tmp/gone.jpg')).not.toThrow();
  });

  it('refuses to delete files outside each vault-managed directory', () => {
    fs.files.set('file:///cache/unrelated.jpg', new Uint8Array([1]));
    fs.files.set('file:///cache/photo-vault/tmp/not-encrypted.jpg', new Uint8Array([2]));

    discardDecryptedPhoto('file:///cache/unrelated.jpg');
    discardEncryptedPhoto('file:///cache/photo-vault/tmp/not-encrypted.jpg');

    expect(fs.files.has('file:///cache/unrelated.jpg')).toBe(true);
    expect(fs.files.has('file:///cache/photo-vault/tmp/not-encrypted.jpg')).toBe(true);
  });
});

// ── Cleanup ────────────────────────────────────────────────────────────────

describe('cleanupPhotoVaultTempFiles', () => {
  async function withBothKinds() {
    seedPhoto();
    const { encryptedUri } = await encryptPhotoFile({
      sourceUri: SOURCE,
      vaultKeyBase64: KEY,
      vaultKeyVersion: 1,
    });
    const { uri: plaintextUri } = await decryptPhotoFile({
      encryptedUri,
      vaultKeyBase64: KEY,
    });
    return { encryptedUri, plaintextUri };
  }

  it('removes decrypted files by default', async () => {
    const { plaintextUri } = await withBothKinds();

    cleanupPhotoVaultTempFiles();

    expect(fs.files.has(plaintextUri)).toBe(false);
  });

  it('keeps encrypted files by default', async () => {
    const { encryptedUri } = await withBothKinds();

    // A .enc may still be waiting for an upload that has not happened yet.
    cleanupPhotoVaultTempFiles();

    expect(fs.files.has(encryptedUri)).toBe(true);
  });

  it('removes encrypted files when explicitly asked', async () => {
    const { encryptedUri, plaintextUri } = await withBothKinds();

    cleanupPhotoVaultTempFiles({ includeEncrypted: true });

    expect(fs.files.has(encryptedUri)).toBe(false);
    expect(fs.files.has(plaintextUri)).toBe(false);
  });

  it('never touches files outside the vault subtree', async () => {
    await withBothKinds();
    fs.files.set('file:///cache/avatar.jpg', new Uint8Array([1, 2, 3]));
    fs.files.set('file:///cache/expo-image/abc', new Uint8Array([4, 5]));
    fs.files.set('file:///document/important.db', new Uint8Array([6]));

    cleanupPhotoVaultTempFiles({ includeEncrypted: true });

    expect(fs.files.has('file:///cache/avatar.jpg')).toBe(true);
    expect(fs.files.has('file:///cache/expo-image/abc')).toBe(true);
    expect(fs.files.has('file:///document/important.db')).toBe(true);
    // The source photo the user picked is also untouched.
    expect(fs.files.has(SOURCE)).toBe(true);
  });

  it('is idempotent', async () => {
    await withBothKinds();

    cleanupPhotoVaultTempFiles({ includeEncrypted: true });
    expect(() => cleanupPhotoVaultTempFiles({ includeEncrypted: true })).not.toThrow();
  });

  it('works on a device that has never used the vault', () => {
    expect(() => cleanupPhotoVaultTempFiles()).not.toThrow();
  });

  it('tolerates a file vanishing mid-sweep', async () => {
    const { plaintextUri } = await withBothKinds();
    fs.files.delete(plaintextUri);

    expect(() => cleanupPhotoVaultTempFiles()).not.toThrow();
  });
});

describe('the share/ export queue', () => {
  describe('directory', () => {
    it('lives as a sibling of tmp/ and enc/, not inside either', () => {
      const { uri } = createPhotoVaultShareFilePath();

      expect(uri).toMatch(/^file:\/\/\/cache\/photo-vault\/share\/[^/]+\.jpg$/);
      expect(uri).not.toContain('/photo-vault/tmp/share/');
      expect(uri).not.toContain('/photo-vault/enc/share/');
    });

    it('creates the directory idempotently across repeated calls', () => {
      const first = createPhotoVaultShareFilePath();
      const second = createPhotoVaultShareFilePath();

      expect(first.uri).not.toBe(second.uri);
      expect(() => createPhotoVaultShareFilePath()).not.toThrow();
    });

    it('a device that has never exported anything sweeps without error', () => {
      expect(() => cleanupPhotoVaultShareFiles()).not.toThrow();
    });
  });

  describe('filename', () => {
    it('uses a random identifier and the requested extension', () => {
      const { uri } = createPhotoVaultShareFilePath('.jpg');
      const name = uri.split('/').pop()!;

      expect(name).toMatch(/^[0-9a-f-]{36}\.jpg$/i);
    });

    it('defaults to .jpg when no extension is given', () => {
      const { uri } = createPhotoVaultShareFilePath();
      expect(uri.endsWith('.jpg')).toBe(true);
    });

    it('two exports in the same session never collide', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 20; i += 1) seen.add(createPhotoVaultShareFilePath().uri);
      expect(seen.size).toBe(20);
    });

    // The filename must carry no fact about which photos, day, pose or
    // account produced it — the whole point of a neutral export name.
    it.each([
      ['a uid', 'alice-uid-12345'],
      ['a photoId', '2026-08-15_front'],
      ['a dateKey', '2026-08-15'],
      ['a pose', 'front'],
      ['a pose', 'side'],
      ['a pose', 'back'],
    ])('never embeds %s (%s) in the filename', (_label, forbidden) => {
      const { uri } = createPhotoVaultShareFilePath();
      expect(uri).not.toContain(forbidden);
    });
  });

  describe('discard', () => {
    it('removes a file that genuinely lives in share/', () => {
      const { uri } = createPhotoVaultShareFilePath();
      fs.files.set(uri, new Uint8Array([1, 2, 3]));

      discardPhotoVaultShareFile(uri);

      expect(fs.files.has(uri)).toBe(false);
    });

    it('is idempotent for a file that no longer exists', () => {
      const { uri } = createPhotoVaultShareFilePath();
      expect(() => discardPhotoVaultShareFile(uri)).not.toThrow();
    });

    it('refuses a path outside share/ entirely', () => {
      const outside = 'file:///cache/photo-vault/tmp/innocent.jpg';
      fs.files.set(outside, new Uint8Array([1]));

      discardPhotoVaultShareFile(outside);

      expect(fs.files.has(outside)).toBe(true);
    });

    it('refuses a path traversal attempt disguised with the right prefix', () => {
      // Starts with the share/ prefix as a STRING even though `..` segments
      // would make it resolve outside the directory on a real filesystem.
      // The in-memory mock does not resolve `..`, so the meaningful assertion
      // is the CONTRACT: this exact literal is never handed to `.delete()`,
      // regardless of what an OS would later resolve it to.
      const traversal = 'file:///cache/photo-vault/share/../../../secrets/x.jpg';
      fs.files.set(traversal, new Uint8Array([9]));

      discardPhotoVaultShareFile(traversal);

      expect(fs.files.has(traversal)).toBe(true);
    });

    it('refuses any string containing a .. segment, independent of the rest', () => {
      // Isolates the `..` guard from the nested-segment guard: this path has
      // no extra `/` after a valid-looking remainder, only `..`.
      const traversal = 'file:///cache/photo-vault/share/..evil.jpg';
      fs.files.set(traversal, new Uint8Array([9]));

      discardPhotoVaultShareFile(traversal);

      expect(fs.files.has(traversal)).toBe(true);
    });

    it('refuses a nested path that merely starts with the share/ prefix', () => {
      const nested = 'file:///cache/photo-vault/share/nested/x.jpg';
      fs.files.set(nested, new Uint8Array([1]));

      discardPhotoVaultShareFile(nested);

      // share/ is flat by contract; a nested path is never legitimate.
      expect(fs.files.has(nested)).toBe(true);
    });

    it('refuses a similarly-named sibling directory', () => {
      const lookalike = 'file:///cache/photo-vault/share-other/x.jpg';
      fs.files.set(lookalike, new Uint8Array([1]));

      discardPhotoVaultShareFile(lookalike);

      expect(fs.files.has(lookalike)).toBe(true);
    });

    it('refuses an empty or malformed string without throwing', () => {
      expect(() => discardPhotoVaultShareFile('')).not.toThrow();
      expect(() => discardPhotoVaultShareFile('not-a-uri')).not.toThrow();
    });
  });

  describe('cleanupPhotoVaultShareFiles (startup / logout)', () => {
    it('removes every export file', () => {
      const a = createPhotoVaultShareFilePath();
      const b = createPhotoVaultShareFilePath();
      fs.files.set(a.uri, new Uint8Array([1]));
      fs.files.set(b.uri, new Uint8Array([2]));

      cleanupPhotoVaultShareFiles();

      expect(fs.files.has(a.uri)).toBe(false);
      expect(fs.files.has(b.uri)).toBe(false);
    });

    it('never touches tmp/, enc/, or files outside the vault', async () => {
      seedPhoto();
      const { encryptedUri } = await encryptPhotoFile({
        sourceUri: SOURCE,
        vaultKeyBase64: KEY,
        vaultKeyVersion: 1,
      });
      const { uri: plaintextUri } = await decryptPhotoFile({
        encryptedUri,
        vaultKeyBase64: KEY,
      });
      fs.files.set('file:///cache/avatar.jpg', new Uint8Array([1]));
      const { uri: shareUri } = createPhotoVaultShareFilePath();
      fs.files.set(shareUri, new Uint8Array([3]));

      cleanupPhotoVaultShareFiles();

      expect(fs.files.has(shareUri)).toBe(false);
      expect(fs.files.has(encryptedUri)).toBe(true);
      expect(fs.files.has(plaintextUri)).toBe(true);
      expect(fs.files.has('file:///cache/avatar.jpg')).toBe(true);
    });

    it('is idempotent and safe on a device that never exported anything', () => {
      cleanupPhotoVaultShareFiles();
      expect(() => cleanupPhotoVaultShareFiles()).not.toThrow();
    });

    it('tolerates a file vanishing mid-sweep', () => {
      const { uri } = createPhotoVaultShareFilePath();
      fs.files.set(uri, new Uint8Array([1]));
      fs.files.delete(uri);

      expect(() => cleanupPhotoVaultShareFiles()).not.toThrow();
    });
  });

  describe('lock/background must NOT reach share/', () => {
    it('cleanupPhotoVaultTempFiles never removes an export file, with or without includeEncrypted', () => {
      const { uri } = createPhotoVaultShareFilePath();
      fs.files.set(uri, new Uint8Array([1]));

      // This is exactly what `lockPhotoVault()` calls on every lock/background
      // transition (see photoVaultLock.ts). If this test ever fails, the OS
      // share sheet can lose the file it is mid-read on.
      cleanupPhotoVaultTempFiles();
      expect(fs.files.has(uri)).toBe(true);

      cleanupPhotoVaultTempFiles({ includeEncrypted: true });
      expect(fs.files.has(uri)).toBe(true);
    });

    it('the temp sweep and the share sweep are two independently callable functions', () => {
      // Structural guard against a future "simplification" that folds share/
      // into the generic sweep — see the doc comment on
      // `cleanupPhotoVaultShareFiles` for why that would reintroduce a race.
      expect(cleanupPhotoVaultTempFiles).not.toBe(cleanupPhotoVaultShareFiles);
      const { uri } = createPhotoVaultShareFilePath();
      fs.files.set(uri, new Uint8Array([1]));

      cleanupPhotoVaultTempFiles({ includeEncrypted: true });
      expect(fs.files.has(uri)).toBe(true);

      cleanupPhotoVaultShareFiles();
      expect(fs.files.has(uri)).toBe(false);
    });
  });
});

// ── Structural guarantees ──────────────────────────────────────────────────

describe('no cloud, no cache, no persistence', () => {
  it('never touches AsyncStorage or Firebase from this layer', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/photoVaultFileCrypto.ts', 'utf8');

    expect(source).not.toContain('AsyncStorage');
    expect(source).not.toContain('firebase/storage');
    expect(source).not.toContain('firebase/firestore');
    expect(source).not.toContain('httpsCallable');
    // Rendering (and its disk cache) belongs to a later phase.
    expect(source).not.toContain('expo-image');
    expect(source).not.toContain('memory-disk');
  });

  it('keeps plaintext out of the document directory', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/photoVaultFileCrypto.ts', 'utf8');

    expect(source).not.toMatch(/Paths\.document/);
  });

  it('keeps the crypto layer free of storage and network concerns', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultCrypto.ts', 'utf8');

    expect(source).not.toContain('expo-file-system');
    expect(source).not.toContain('expo-secure-store');
    expect(source).not.toContain('firebase');
  });

  it('does not import the Comparator dependencies yet (phase 15A infra only)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of [
      'src/services/photoVaultFileCrypto.ts',
      'App.tsx',
      'src/state/PhotoVaultContext.tsx',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} must not import expo-sharing yet`).not.toContain(
        'expo-sharing',
      );
      expect(
        source,
        `${file} must not import react-native-view-shot yet`,
      ).not.toContain('react-native-view-shot');
    }
  });
});
