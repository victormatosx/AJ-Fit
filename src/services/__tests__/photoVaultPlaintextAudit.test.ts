import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Structural audit of where decrypted image data is allowed to exist.
 *
 * The invariant this phase has to hold, stated precisely:
 *
 *   - no thumbnail plaintext on the filesystem, in any form;
 *   - no thumbnail plaintext as a JavaScript byte array — the native module
 *     produces base64 directly;
 *   - decrypted base64 DOES live in memory while the vault is unlocked. That
 *     is plaintext. It is bounded by the session LRU and released by
 *     lock/logout; it is not, and must not be described as, absent.
 *
 * These are source assertions because the project has no component renderer.
 * They are cheap to run and they fail loudly if a later change reintroduces a
 * durable plaintext path.
 */

/**
 * Comments legitimately name the things the code avoids ("uses Image rather
 * than expo-image, because…"), so assertions about behaviour run against a
 * comment-stripped view. Assertions about documentation run against the raw
 * source.
 */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const CACHE = codeOf('src/services/photoVaultEncryptedCache.ts');
const SERVICE = codeOf('src/services/progressPhotos.ts');
const GALLERY = codeOf('src/lib/photoVaultGallery.ts');
const CRYPTO = readFileSync('src/lib/photoVaultCrypto.ts', 'utf8');
const GRID = codeOf('src/components/photoVault/PhotoVaultGrid.tsx');
const VIEWER = codeOf('src/components/photoVault/PhotoVaultViewer.tsx');

describe('the persistent cache holds ciphertext only', () => {
  it('never decrypts and never sees the vault key', () => {
    expect(CACHE).not.toContain('decrypt');
    expect(CACHE).not.toContain('vaultKey');
    expect(CACHE).not.toContain('photoVaultCrypto');
  });

  it('knows nothing about Firebase, React or the UI', () => {
    expect(CACHE).not.toContain('firebase');
    expect(CACHE).not.toContain('react');
    expect(CACHE).not.toContain('getDownloadURL');
  });

  it('writes only the encrypted envelope extension', () => {
    expect(CACHE).toContain(".thumb.enc'");
    expect(CACHE).not.toMatch(/'\.(jpg|jpeg|png|webp)'/);
  });

  it('lives under the reclaimable cache directory, never durable app storage', () => {
    expect(CACHE).toContain('Paths.cache');
    expect(CACHE).not.toContain('Paths.document');
  });

  it('persists no index or metadata sidecar', () => {
    expect(CACHE).not.toContain('AsyncStorage');
    expect(CACHE).not.toContain('SecureStore');
    expect(CACHE).not.toContain('JSON.stringify');
  });
});

describe('thumbnail plaintext never reaches storage', () => {
  it('decrypts thumbnails straight to base64 rather than to a file', () => {
    expect(SERVICE).toContain('decryptBytesToBase64');
    expect(SERVICE).toContain('data:image/jpeg;base64,');
  });

  it('keeps the file-writing decrypt for full images only', () => {
    // `decryptPhotoFile` still exists — the viewer's full pipeline is
    // deliberately unchanged by this phase — but it must not be reachable
    // from the thumbnail path.
    const thumbnailPath = SERVICE.slice(
      SERVICE.indexOf('async function loadThumbnail'),
      SERVICE.indexOf('export async function downloadProgressPhotoThumbnail'),
    );
    expect(thumbnailPath.length).toBeGreaterThan(0);
    expect(thumbnailPath).not.toContain('decryptPhotoFile');
    expect(thumbnailPath).not.toContain('writeEncryptedFile');
  });

  it('never persists a decrypted representation anywhere durable', () => {
    for (const source of [SERVICE, GALLERY, CACHE]) {
      expect(source).not.toContain('AsyncStorage');
      expect(source).not.toContain('Paths.document');
      expect(source).not.toContain('getDownloadURL');
      expect(source).not.toContain('memory-disk');
    }
  });

  it('never writes base64 to a file', () => {
    expect(SERVICE).not.toMatch(/write\([^)]*base64/i);
    expect(GALLERY).not.toContain('.write(');
  });
});

describe('the memory-only representation is documented as plaintext', () => {
  it('does not claim base64 stops being plaintext', () => {
    // If this ever reads as "no plaintext in memory", the security posture is
    // being described incorrectly and the docs are wrong too.
    expect(CRYPTO).toContain('base64 IS plaintext');
    expect(CRYPTO).toContain('cannot be zeroed');
  });
});

describe('identity never leaks into object names or the UI', () => {
  const IDENTITY = codeOf('src/lib/photoVaultIdentity.ts');

  it('derives the day from the local calendar, never from UTC', () => {
    expect(IDENTITY).not.toContain('toISOString');
    expect(IDENTITY).not.toContain('getUTC');
    expect(IDENTITY).toContain('date.getFullYear()');
  });

  it('addresses Storage and the cache by asset, never by document id', () => {
    // A posed document is named `{dateKey}_{pose}`. Using it as an object name
    // would publish the day and the pose into the bucket, and using it as a
    // cache filename would do the same on disk.
    for (const call of [
      'storagePathFor(uid, photo.assetId)',
      'thumbnailStoragePathFor(uid, photo.assetId)',
      'readCachedThumbnail({ uid, photoId: photo.assetId',
      'writeCachedThumbnail({ uid, photoId: photo.assetId',
      'removeCachedThumbnail(uid, photo.assetId)',
    ]) {
      expect(SERVICE).toContain(call);
    }
    expect(SERVICE).not.toContain('storagePathFor(uid, photo.photoId)');
    expect(SERVICE).not.toContain('thumbnailStoragePathFor(uid, photo.photoId)');
    expect(SERVICE).not.toContain('photoId: photo.photoId');
  });

  it('lets the caller choose a pose and nothing else', () => {
    // The UI must never supply an asset id, a document id, a storage path or
    // a day: those are the service's authority.
    // The interface body only — the shared upload helpers that follow it do
    // legitimately mention paths and asset ids.
    const start = SERVICE.indexOf('export interface UploadProgressPhotoParams');
    const params = SERVICE.slice(start, SERVICE.indexOf('\n}', start));
    expect(params).toContain('pose?: ProgressPhotoPose');
    for (const forbidden of ['assetId', 'documentId', 'storagePath', 'dateKey']) {
      expect(params).not.toContain(forbidden);
    }
  });

  it('keeps pose out of the encryption layer', () => {
    expect(CRYPTO).not.toContain('pose');
    expect(CRYPTO).not.toContain('dateKey');
    expect(CRYPTO).not.toContain('assetId');
  });
});

describe('the UI renders without a second cache', () => {
  it('uses React Native Image, not a library with its own disk cache', () => {
    for (const source of [GRID, VIEWER]) {
      expect(source).not.toContain('expo-image');
      expect(source).not.toContain('memory-disk');
      expect(source).not.toContain('cachePolicy');
    }
  });

  it('takes whatever URI the controller hands it, without building paths', () => {
    for (const source of [GRID, VIEWER]) {
      // The UI must not know whether it is painting a data URI or a file URI,
      // and must never construct a vault path of its own.
      expect(source).not.toContain('expo-file-system');
      expect(source).not.toContain('Paths.');
      expect(source).not.toContain('data:image');
      expect(source).not.toContain('encrypted-thumbnails');
    }
  });
});
