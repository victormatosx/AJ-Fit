import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from 'firebase/storage';
import { storage } from '../lib/firebase';

export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export type LocalProfilePhoto = {
  uri: string;
  mimeType?: string | null;
  fileSize?: number;
  width: number;
  height: number;
};

type CompressionAttempt = {
  maxDimension: number;
  quality: number;
};

const JPEG_COMPRESSION_PLAN: CompressionAttempt[] = [
  { maxDimension: 1600, quality: 0.9 },
  { maxDimension: 1400, quality: 0.86 },
  { maxDimension: 1200, quality: 0.82 },
  { maxDimension: 1000, quality: 0.78 },
  { maxDimension: 800, quality: 0.74 },
  { maxDimension: 640, quality: 0.7 },
];

const PNG_COMPRESSION_PLAN: CompressionAttempt[] = [
  { maxDimension: 1600, quality: 1 },
  { maxDimension: 1280, quality: 1 },
  { maxDimension: 1024, quality: 1 },
  { maxDimension: 768, quality: 1 },
  { maxDimension: 512, quality: 1 },
];

function avatarRef(uid: string) {
  return ref(storage, `users/${uid}/profile/avatar`);
}

function isPng(photo: LocalProfilePhoto): boolean {
  return photo.mimeType?.toLowerCase() === 'image/png' || /\.png(?:$|\?)/i.test(photo.uri);
}

function resizedDimensions(photo: LocalProfilePhoto, maxDimension: number) {
  const largestDimension = Math.max(photo.width, photo.height);
  if (largestDimension <= maxDimension) return null;
  const scale = maxDimension / largestDimension;
  return {
    width: Math.max(1, Math.round(photo.width * scale)),
    height: Math.max(1, Math.round(photo.height * scale)),
  };
}

function fileSize(uri: string): number {
  return new File(uri).size ?? 0;
}

/**
 * Normalizes a cropped picker result before upload. PNG stays lossless so its
 * alpha channel is preserved; photos use progressively gentler JPEG passes.
 * Each attempt starts from the cropped source to avoid cumulative artifacts.
 */
export async function compressProfilePhoto(
  photo: LocalProfilePhoto,
): Promise<LocalProfilePhoto> {
  const png = isPng(photo);
  const format = png ? SaveFormat.PNG : SaveFormat.JPEG;
  const mimeType = png ? 'image/png' : 'image/jpeg';
  const plan = png ? PNG_COMPRESSION_PLAN : JPEG_COMPRESSION_PLAN;

  for (const attempt of plan) {
    const context = ImageManipulator.manipulate(photo.uri);
    const dimensions = resizedDimensions(photo, attempt.maxDimension);
    if (dimensions) context.resize(dimensions);

    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({
      format,
      compress: attempt.quality,
    });
    const size = fileSize(result.uri);

    if (size > 0 && size <= PROFILE_PHOTO_MAX_BYTES) {
      return {
        uri: result.uri,
        mimeType,
        fileSize: size,
        width: result.width,
        height: result.height,
      };
    }
  }

  throw new Error('profile-photo-too-large');
}

/** Replaces the user's single avatar object, so updates never create orphan files. */
export async function uploadProfilePhoto(
  uid: string,
  photo: LocalProfilePhoto,
  onProgress?: (progress: number) => void,
): Promise<string> {
  if (photo.fileSize && photo.fileSize > PROFILE_PHOTO_MAX_BYTES) {
    throw new Error('profile-photo-too-large');
  }

  const file = new File(photo.uri);
  if (file.size > PROFILE_PHOTO_MAX_BYTES) throw new Error('profile-photo-too-large');

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await file.bytes();
  } catch {
    throw new Error('profile-photo-read-failed');
  }
  if (bytes.byteLength > PROFILE_PHOTO_MAX_BYTES) {
    throw new Error('profile-photo-too-large');
  }

  const contentType = photo.mimeType || file.type || 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error('profile-photo-invalid-type');

  const target = avatarRef(uid);
  const task = uploadBytesResumable(target, bytes, {
    contentType,
    // Each upload receives a new Firestore photoVersion, so this representation
    // can remain immutable in the requesting device's memory and disk caches.
    cacheControl: 'private,max-age=31536000,immutable',
  });

  await new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => {
        const progress = snapshot.totalBytes
          ? snapshot.bytesTransferred / snapshot.totalBytes
          : 0;
        onProgress?.(progress);
      },
      reject,
      resolve,
    );
  });
  const downloadURL = await getDownloadURL(target);
  const separator = downloadURL.includes('?') ? '&' : '?';
  return `${downloadURL}${separator}g=${encodeURIComponent(task.snapshot.metadata.generation)}`;
}

export async function deleteProfilePhoto(uid: string): Promise<void> {
  try {
    await deleteObject(avatarRef(uid));
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    if (code !== 'storage/object-not-found') throw err;
  }
}
