import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_VERSION,
  decryptBytes,
  encryptBytes,
} from '../lib/photoVaultCrypto';
import { PhotoVaultError, isPhotoVaultError } from '../lib/photoVaultErrors';

/**
 * File pipeline for the Photo Vault.
 *
 * Turns an on-device image into an encrypted `.enc` file and back. It knows
 * about the filesystem; it does not know about Firebase, Firestore, Storage,
 * the image picker or any UI — uploading is the next phase, and this layer
 * works entirely offline.
 *
 * IMPORTANT SCOPE NOTE: encrypting a photo protects the copy AJ Fit keeps.
 * When the picker is added later, the user's original photo remains in the
 * device photo library, untouched and unencrypted. This layer never deletes
 * or rewrites anything outside its own directories, and the product must not
 * claim otherwise.
 */

const VAULT_ROOT = 'photo-vault';
/** Encrypted files awaiting a future upload step. */
const ENCRYPTED_DIR = 'enc';
/** Decrypted images. Short-lived by contract — see `decryptPhotoFile`. */
const PLAINTEXT_DIR = 'tmp';
/**
 * Composed exports (Comparator, future phases) waiting to be handed to the OS
 * share sheet. Plaintext, exactly like `tmp/`, but deliberately a SEPARATE
 * sibling directory rather than a child of `tmp/` — see the block comment
 * above `cleanupPhotoVaultShareFiles` for why the two must never share a
 * cleanup call site.
 */
const SHARE_DIR = 'share';

/**
 * Everything lives under the cache directory, never the document directory:
 * plaintext must never look like durable app data, and the OS is free to
 * reclaim these files under storage pressure.
 */
function vaultDirectory(child: string): Directory {
  const directory = new Directory(Paths.cache, VAULT_ROOT, child);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/** Unpredictable name so a plaintext file is never guessable by path. */
function randomName(extension: string): string {
  return `${randomUUID()}${extension}`;
}

function belongsToVaultDirectory(uri: string, child: string): boolean {
  const directoryUri = vaultDirectory(child).uri.replace(/\/$/, '');
  return uri.startsWith(`${directoryUri}/`);
}

export interface EncryptedPhotoResult {
  encryptedUri: string;
  encryptedSize: number;
  encryption: {
    version: number;
    algorithm: string;
    /** Base64 nonce — the same value framed inside the file. */
    iv: string;
    vaultKeyVersion: number;
  };
}

async function readBytes(uri: string): Promise<Uint8Array> {
  try {
    // `await` matters: `bytes()` is async, so without it a rejected read
    // would escape this catch entirely.
    return await new File(uri).bytes();
  } catch {
    throw new PhotoVaultError('vaultFileReadFailed');
  }
}

/** Deletes best-effort; a missing file is success, not an error. */
function removeQuietly(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Ignored on purpose: cleanup must never mask the original failure.
  }
}

/**
 * Encrypts an image file into a `.enc` envelope.
 *
 * The returned `iv` is the exact nonce framed inside the file — there is one
 * source of truth, so the Firestore metadata from phase 4 can never drift
 * from the file it describes.
 */
export async function encryptPhotoFile(params: {
  sourceUri: string;
  vaultKeyBase64: string;
  vaultKeyVersion: number;
}): Promise<EncryptedPhotoResult> {
  const { sourceUri, vaultKeyBase64, vaultKeyVersion } = params;

  const plaintext = await readBytes(sourceUri);
  if (plaintext.length === 0) {
    throw new PhotoVaultError('vaultFileReadFailed');
  }

  let encrypted: Awaited<ReturnType<typeof encryptBytes>>;
  try {
    encrypted = await encryptBytes(plaintext, vaultKeyBase64);
  } finally {
    // File.bytes() returns an owned buffer. Zero the JS copy as soon as the
    // native crypto call has consumed it; GC timing is not a security policy.
    plaintext.fill(0);
  }
  const { bytes, iv } = encrypted;

  const target = new File(vaultDirectory(ENCRYPTED_DIR), randomName('.enc'));
  try {
    target.write(bytes);
  } catch {
    // A partially written envelope is worse than none: it would look like a
    // real vault file to every later step.
    removeQuietly(target.uri);
    throw new PhotoVaultError('vaultFileWriteFailed');
  }

  return {
    encryptedUri: target.uri,
    encryptedSize: bytes.length,
    encryption: {
      version: ENCRYPTION_VERSION,
      algorithm: ENCRYPTION_ALGORITHM,
      iv,
      vaultKeyVersion,
    },
  };
}

/**
 * Decrypts a `.enc` file into a temporary image file.
 *
 * The result is deliberately temporary: it lives in the vault's cache
 * subtree under a random name and the caller is expected to remove it as
 * soon as it is done (or let `cleanupPhotoVaultTempFiles` do it). Decrypted
 * photos are never durable app data.
 */
export async function decryptPhotoFile(params: {
  encryptedUri: string;
  vaultKeyBase64: string;
  extension?: string;
}): Promise<{ uri: string; size: number }> {
  const { encryptedUri, vaultKeyBase64, extension = '.jpg' } = params;

  const envelope = await readBytes(encryptedUri);
  const plaintext = await decryptBytes(envelope, vaultKeyBase64);

  const target = new File(vaultDirectory(PLAINTEXT_DIR), randomName(extension));
  try {
    target.write(plaintext);
  } catch {
    removeQuietly(target.uri);
    plaintext.fill(0);
    throw new PhotoVaultError('vaultFileWriteFailed');
  }

  const size = plaintext.length;
  plaintext.fill(0);
  return { uri: target.uri, size };
}

/**
 * Moves a picker/manipulator result into the vault-controlled plaintext area.
 *
 * ImageManipulator writes into its own general cache. Leaving that URI there
 * would evade the crash/startup sweep, so the normalized copy is immediately
 * copied into `<cache>/photo-vault/tmp` and its source copy is removed. The
 * user's original gallery asset is never passed here — only the manipulator's
 * newly-created output is consumed.
 */
export async function stagePhotoVaultPlaintext(
  sourceUri: string,
): Promise<{ uri: string; size: number }> {
  const source = new File(sourceUri);
  const target = new File(vaultDirectory(PLAINTEXT_DIR), randomName('.jpg'));
  try {
    if (!source.exists || (source.size ?? 0) <= 0) {
      throw new PhotoVaultError('vaultFileReadFailed');
    }
    // Native file-to-file copy avoids materializing an additional plaintext
    // Uint8Array in JS merely to move ImageManipulator output under the
    // vault-owned crash-cleanup subtree.
    await source.copy(target);
    const size = target.size ?? 0;
    if (size <= 0) throw new PhotoVaultError('vaultFileWriteFailed');
    return { uri: target.uri, size };
  } catch (err) {
    removeQuietly(target.uri);
    if (isPhotoVaultError(err)) throw err;
    throw new PhotoVaultError('vaultFileWriteFailed');
  } finally {
    // This is the ImageManipulator output, never the user's library asset.
    removeQuietly(sourceUri);
  }
}

/**
 * Removes an ImageManipulator output that was rejected before staging.
 * Restricted to the app cache; content/document/library URIs are ignored.
 */
export function discardPhotoVaultPickerOutput(uri: string): void {
  const cacheUri = Paths.cache.uri.replace(/\/$/, '');
  if (uri.startsWith(`${cacheUri}/`)) removeQuietly(uri);
}

/** Removes a single decrypted file once the caller is finished with it. */
export function discardDecryptedPhoto(uri: string): void {
  if (belongsToVaultDirectory(uri, PLAINTEXT_DIR)) removeQuietly(uri);
}

/** Removes a single encrypted file (after upload, or after a failed download). */
export function discardEncryptedPhoto(uri: string): void {
  if (belongsToVaultDirectory(uri, ENCRYPTED_DIR)) removeQuietly(uri);
}

/**
 * Stores downloaded ciphertext in the vault's encrypted temp directory.
 *
 * Kept separate from `encryptPhotoFile` because the bytes here came from the
 * network and have not been validated yet — they land in the same directory
 * so the existing cleanup covers them either way.
 */
export function writeEncryptedFile(bytes: Uint8Array): { uri: string } {
  const target = new File(vaultDirectory(ENCRYPTED_DIR), randomName('.enc'));
  try {
    target.write(bytes);
  } catch {
    removeQuietly(target.uri);
    throw new PhotoVaultError('vaultFileWriteFailed');
  }
  return { uri: target.uri };
}

/**
 * Whether `uri` names a direct child of `share/`, and only that.
 *
 * Deliberately stricter than `belongsToVaultDirectory`'s plain prefix check
 * above. Every other discard function in this module only ever receives a
 * URI this module minted itself; `share/` is different — its whole purpose is
 * to hand a path to code outside this module (a future composition step, the
 * OS share sheet), so a caller could in principle pass back a crafted or
 * malformed string. A prefix check alone does not close that gap:
 * `.../photo-vault/share/../../../secrets/x` starts with the right prefix as
 * a STRING even though it does not resolve inside the directory. Two
 * independent conditions here do close it: no `..` segment anywhere, and
 * nothing after the directory prefix but a single path segment — `share/` is
 * flat by design (see `cleanupPhotoVaultShareFiles`), so a legitimate export
 * can never be nested.
 */
function isSafeShareUri(uri: string): boolean {
  if (typeof uri !== 'string' || uri.length === 0 || uri.includes('..')) {
    return false;
  }
  const directoryUri = vaultDirectory(SHARE_DIR).uri.replace(/\/$/, '');
  const prefix = `${directoryUri}/`;
  if (!uri.startsWith(prefix)) return false;
  const remainder = uri.slice(prefix.length);
  return remainder.length > 0 && !remainder.includes('/');
}

/**
 * Reserves a fresh, neutral path inside `share/` for a future export.
 *
 * Does not touch the filesystem — it only names a location. A later phase
 * writes the composed image to this exact URI. The name is a random UUID
 * from the same source `randomName` uses everywhere else in this module, so
 * it carries no uid, assetId, photoId, pose or dateKey: the filename itself
 * reveals nothing about which photos were involved.
 */
export function createPhotoVaultShareFilePath(extension = '.jpg'): { uri: string } {
  const target = new File(vaultDirectory(SHARE_DIR), randomName(extension));
  return { uri: target.uri };
}

/**
 * Removes one export file once the caller is done with it — after a share
 * completes, or when abandoning one that failed to build.
 *
 * Fails closed: a URI that is not a direct child of `share/` is never
 * touched, silently. This is the only thing standing between a future
 * caller's URI (view-shot output, a share-sheet callback) and deleting
 * something outside the vault's own directory.
 */
export function discardPhotoVaultShareFile(uri: string): void {
  if (isSafeShareUri(uri)) removeQuietly(uri);
}

/**
 * Removes every file in `photo-vault/share/`.
 *
 * DELIBERATELY separate from `cleanupPhotoVaultTempFiles`, and DELIBERATELY
 * never called by `lockPhotoVault()`. `share/` can hold a plaintext export
 * the OS share sheet is still reading after this app goes
 * `inactive`/`background` — `Sharing.shareAsync()` can outlive the frame in
 * which the user tapped Share. Folding this into the Vault's normal
 * lock-triggered sweep would delete that file out from under the OS the
 * moment the app backgrounds, which is exactly the race this separation
 * exists to avoid. The Vault's own lock/background handling
 * (`photoVaultLock.ts`) is untouched by this module and stays exactly as
 * strict as it is today — no exception was added there for sharing.
 *
 * `share/` is not a secure cache either: it is a plaintext export queue with
 * one job, and it is emptied by three triggers only:
 *   - explicitly, once a share completes (a later phase wires this call);
 *   - on logout / account switch — a session ending is an explicit boundary
 *     that a mere background transition is not;
 *   - on the next cold start, as crash recovery for whatever a kill left
 *     behind.
 *
 * A future "simplification" that merges this sweep into the Vault's temp
 * cleanup, or calls it from the lock path, would reintroduce that race.
 */
export function cleanupPhotoVaultShareFiles(): void {
  try {
    for (const entry of vaultDirectory(SHARE_DIR).list()) {
      try {
        entry.delete();
      } catch {
        // Already gone, or held by the OS — not worth failing the sweep.
      }
    }
  } catch (err) {
    if (isPhotoVaultError(err)) throw err;
    throw new PhotoVaultError('vaultShareCleanupFailed');
  }
}

export interface CleanupOptions {
  /**
   * Also remove encrypted files. Off by default: a `.enc` may be waiting for
   * an upload that has not happened yet, and deleting it would lose data.
   */
  includeEncrypted?: boolean;
}

/**
 * Removes the vault's temporary files.
 *
 * Scope is strictly the vault's own subtree of the cache directory, so this
 * can never touch the avatar, the image cache, or anything else the app or
 * another library stores. Idempotent, and tolerant of files that vanished
 * between listing and deletion.
 */
export function cleanupPhotoVaultTempFiles(options: CleanupOptions = {}): void {
  const targets = options.includeEncrypted
    ? [PLAINTEXT_DIR, ENCRYPTED_DIR]
    : [PLAINTEXT_DIR];

  try {
    for (const child of targets) {
      for (const entry of vaultDirectory(child).list()) {
        try {
          entry.delete();
        } catch {
          // Already gone, or held by the OS — not worth failing the sweep.
        }
      }
    }
  } catch (err) {
    if (isPhotoVaultError(err)) throw err;
    throw new PhotoVaultError('vaultTempCleanupFailed');
  }
}
