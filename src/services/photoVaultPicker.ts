import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

import type { ProgressPhotoMimeType } from './progressPhotos';
import { startPhotoVaultPerf } from '../lib/photoVaultPerformance';
import {
  discardPhotoVaultPickerOutput,
  stagePhotoVaultPlaintext,
} from './photoVaultFileCrypto';

/**
 * Picking and normalizing a photo for the vault.
 *
 * Permissions are requested only when the user chooses that specific source
 * — never on mount, and never for the source they did not pick.
 *
 * Privacy note: a photo chosen from the library is never modified or
 * deleted; AJ Fit only reads it. A photo taken through the camera here is
 * NOT written to the device photo library — `expo-image-picker` returns it
 * from the app's own cache and only saves to the library when explicitly
 * asked, which this code never does.
 */

export type PickerOutcome =
  | {
      status: 'picked';
      sourceUri: string;
      mimeType: ProgressPhotoMimeType;
      takenAt: Date;
      width: number;
      height: number;
    }
  | { status: 'cancelled' }
  | { status: 'permissionDenied' }
  | { status: 'unsupported' }
  | { status: 'failed' };

/**
 * Normalization before encryption.
 *
 * A 1600px long edge at quality 0.85 keeps body-composition detail legible
 * while landing far below the 10 MB ceiling, which matters three times over:
 * the file is encrypted in memory, uploaded, and downloaded again later.
 * Deliberately gentler than the avatar pipeline, which can afford to be
 * aggressive because an avatar is displayed small.
 */
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

/** 480 px closely covers a ~160pt two-column card at 3x without excess. */
export const PHOTO_VAULT_THUMBNAIL_MAX_DIMENSION = 480;
export const PHOTO_VAULT_THUMBNAIL_JPEG_QUALITY = 0.75;

/** Hard ceiling shared with the Storage rules; encryption adds only 36 bytes. */
const MAX_SOURCE_BYTES = 10 * 1024 * 1024 - 1024;

/**
 * Everything is normalized to JPEG.
 *
 * HEIC/HEIF from an iPhone camera would otherwise reach Storage as a format
 * many viewers cannot decode, and the conversion also strips the container's
 * metadata (including GPS) as a side effect.
 */
const OUTPUT_MIME: ProgressPhotoMimeType = 'image/jpeg';

function resizeForLongEdge(
  width: number,
  height: number,
  maxDimension: number,
): { width?: number; height?: number } {
  if (width >= height) return { width: Math.min(width, maxDimension) };
  return { height: Math.min(height, maxDimension) };
}

async function normalize(
  uri: string,
  width: number,
  height: number,
): Promise<{ uri: string; size: number; width: number; height: number } | null> {
  const finishTiming = startPhotoVaultPerf('picker.normalize');
  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize(resizeForLongEdge(width, height, MAX_DIMENSION));
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: JPEG_QUALITY,
    });

    const size = new File(saved.uri).size ?? 0;
    if (size <= 0 || size > MAX_SOURCE_BYTES) {
      discardPhotoVaultPickerOutput(saved.uri);
      return null;
    }

    // Move the normalized copy into the vault-owned temp subtree so a crash
    // or force-kill cannot strand plaintext in ImageManipulator's cache.
    const staged = await stagePhotoVaultPlaintext(saved.uri);
    return { ...staged, width: saved.width, height: saved.height };
  } catch {
    return null;
  } finally {
    finishTiming();
  }
}

/**
 * Creates a short-lived grid derivative. The caller must encrypt it and then
 * discard the returned URI. It never leaves the vault temp subtree as JPEG.
 */
export async function createPhotoVaultThumbnail(params: {
  sourceUri: string;
  width: number;
  height: number;
}): Promise<{ uri: string; size: number; width: number; height: number }> {
  const context = ImageManipulator.manipulate(params.sourceUri);
  context.resize(
    resizeForLongEdge(
      params.width,
      params.height,
      PHOTO_VAULT_THUMBNAIL_MAX_DIMENSION,
    ),
  );
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: PHOTO_VAULT_THUMBNAIL_JPEG_QUALITY,
  });
  const staged = await stagePhotoVaultPlaintext(saved.uri);
  return { ...staged, width: saved.width, height: saved.height };
}

function takenAtFrom(asset: ImagePicker.ImagePickerAsset): Date {
  // `exif.DateTimeOriginal` is not consistently present across platforms and
  // formats, so the capture time is only used when it parses cleanly.
  const raw = asset.exif?.DateTimeOriginal;
  if (typeof raw === 'string') {
    // EXIF uses "YYYY:MM:DD HH:MM:SS".
    const parsed = Date.parse(raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
    if (!Number.isNaN(parsed) && parsed <= Date.now()) return new Date(parsed);
  }
  return new Date();
}

async function handleAsset(
  result: ImagePicker.ImagePickerResult,
): Promise<PickerOutcome> {
  if (result.canceled) return { status: 'cancelled' };

  const asset = result.assets?.[0];
  if (!asset?.uri) return { status: 'failed' };

  // The extension is not trusted: the file is re-encoded, so whatever came
  // in becomes a known-good JPEG or is rejected.
  const normalized = await normalize(asset.uri, asset.width, asset.height);
  if (!normalized) return { status: 'unsupported' };

  return {
    status: 'picked',
    sourceUri: normalized.uri,
    mimeType: OUTPUT_MIME,
    takenAt: takenAtFrom(asset),
    width: normalized.width,
    height: normalized.height,
  };
}

/** Opens the photo library, asking for its permission only now. */
export async function pickPhotoFromLibrary(): Promise<PickerOutcome> {
  const finishTiming = startPhotoVaultPerf('picker.library');
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    // `limited` (iOS) is enough: the user picks from what they shared.
    if (!permission.granted && permission.status !== 'undetermined') {
      return { status: 'permissionDenied' };
    }

    return await handleAsset(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        exif: true,
        quality: 1,
      }),
    );
  } catch {
    return { status: 'failed' };
  } finally {
    finishTiming();
  }
}

/** Opens the camera, asking for its permission only now. */
export async function takePhotoWithCamera(): Promise<PickerOutcome> {
  const finishTiming = startPhotoVaultPerf('picker.camera');
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: 'permissionDenied' };

    return await handleAsset(
      await ImagePicker.launchCameraAsync({
        // Never written to the device photo library — the vault copy is the
        // only one AJ Fit creates.
        exif: true,
        quality: 1,
      }),
    );
  } catch {
    return { status: 'failed' };
  } finally {
    finishTiming();
  }
}
