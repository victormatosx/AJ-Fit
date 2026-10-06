import * as MediaLibrary from 'expo-media-library';

import { logInfo, logWarn } from '../lib/logger';

export type WorkoutShareArtSaveResult = 'saved' | 'permissionDenied' | 'failed';

export interface WorkoutShareArtSaveDependencies {
  requestPermission: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  saveToLibrary: (uri: string) => Promise<void>;
}

export const defaultWorkoutShareArtSaveDependencies: WorkoutShareArtSaveDependencies = {
  // `writeOnly: true` requests add-only access on iOS (no prompt for read
  // access to the user's existing photos) — the app only ever writes new
  // assets here, never reads the library back.
  requestPermission: () => MediaLibrary.requestPermissionsAsync(true),
  // `saveToLibraryAsync`/`createAssetAsync` imported from the default
  // `expo-media-library` entry point are legacy stubs in SDK 57 — they log
  // a deprecation warning and then *throw* at runtime (see
  // `legacyWarnings.js` in the installed package), which is exactly why
  // "Salvar PNG" was failing. `Asset.create(filePath)` is the class-based
  // replacement the package itself points to; it copies the file's actual
  // bytes into a new library asset (no re-encode), so the PNG's alpha
  // channel survives untouched. The returned `Asset` isn't needed here.
  saveToLibrary: async (uri) => { await MediaLibrary.Asset.create(uri); },
};

export async function saveWorkoutShareArtToLibrary(
  pngUri: string,
  dependencies: WorkoutShareArtSaveDependencies = defaultWorkoutShareArtSaveDependencies,
): Promise<WorkoutShareArtSaveResult> {
  try {
    const permission = await dependencies.requestPermission();
    if (!permission.granted) {
      logInfo('workout_share', 'workout_share_art_save_permission_denied');
      return 'permissionDenied';
    }
    await dependencies.saveToLibrary(pngUri);
    logInfo('workout_share', 'workout_share_art_saved');
    return 'saved';
  } catch (error) {
    logWarn('workout_share', 'workout_share_art_save_failed', { error });
    return 'failed';
  }
}
