import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

import { discardWorkoutShareFile, stageWorkoutSharePhoto } from './files';

export type WorkoutSharePhotoOutcome =
  | { status: 'picked'; uri: string; width: number; height: number }
  | { status: 'cancelled' | 'permissionDenied' | 'failed' };

async function normalize(
  result: ImagePicker.ImagePickerResult,
  discardPickerOutput: boolean,
): Promise<WorkoutSharePhotoOutcome> {
  if (result.canceled) return { status: 'cancelled' };
  const asset = result.assets?.[0];
  if (!asset?.uri || !asset.width || !asset.height) return { status: 'failed' };

  let normalizedUri: string | null = null;
  try {
    // Re-encoding makes HEIC/HEIF and content:// inputs deterministic for Image/view-shot,
    // strips metadata, and keeps the original dimensions for the final 1080x1920 crop.
    const rendered = await ImageManipulator.manipulate(asset.uri).renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.97 });
    normalizedUri = saved.uri;
    const stagedUri = await stageWorkoutSharePhoto(saved.uri);
    return { status: 'picked', uri: stagedUri, width: saved.width, height: saved.height };
  } catch {
    return { status: 'failed' };
  } finally {
    if (normalizedUri) {
      try {
        const file = new File(normalizedUri);
        if (file.exists) file.delete();
      } catch {
        // ImageManipulator cache is also swept by the OS.
      }
    }
    if (discardPickerOutput) {
      try {
        const source = new File(asset.uri);
        if (source.exists) source.delete();
      } catch {
        // Camera output lives in app cache and is also swept by the OS.
      }
    }
  }
}

export async function pickWorkoutSharePhoto(
  source: 'camera' | 'library',
): Promise<WorkoutSharePhotoOutcome> {
  try {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return { status: 'permissionDenied' };
      return normalize(await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 1,
        exif: false,
      }), true);
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted && permission.status !== 'undetermined') {
      return { status: 'permissionDenied' };
    }
    return normalize(await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: false,
    }), false);
  } catch {
    return { status: 'failed' };
  }
}

export function discardWorkoutSharePhoto(uri: string | null): void {
  discardWorkoutShareFile(uri);
}
