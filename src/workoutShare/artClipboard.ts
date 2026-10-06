import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { logInfo, logWarn } from '../lib/logger';

export type WorkoutShareArtClipboardResult = 'copied' | 'unsupported' | 'failed';

export interface WorkoutShareArtClipboardDependencies {
  readBase64: (uri: string) => Promise<string>;
  setImage: (base64: string) => Promise<void>;
  isSupported: () => boolean;
}

/**
 * Real native image clipboard, not a fake "copy the URI/path" shim:
 *
 * - **iOS**: `expo-clipboard` sets `UIPasteboard.general.image` from the
 *   decoded `UIImage`. Because the source PNG carries an alpha channel, the
 *   system pasteboard represents it with a PNG-backed type when another app
 *   (e.g. Instagram Stories' sticker importer) reads it back — the same
 *   mechanism sticker-style apps rely on. Confirmed by reading
 *   `expo-clipboard`'s `ClipboardModule.swift` (`UIPasteboard.general.image
 *   = UIImage(data: data)`), not merely assumed.
 * - **Android**: `expo-clipboard` detects the PNG signature in the base64,
 *   writes a real `.png` file, and exposes it to other apps via its own
 *   `FileProvider` (`ClipboardFileProvider`) + `ClipData.newUri(...)` — a
 *   genuine `content://` URI backed by a real PNG file on disk, readable by
 *   any app's `ContentResolver`, not a bare path/base64 string.
 *
 * Neither platform can guarantee the *receiving* app (Instagram) accepts the
 * payload — that is outside what any clipboard API can promise. "Salvar
 * PNG" (`artSave.ts`) is the reliable fallback for that case.
 */
export const defaultWorkoutShareArtClipboardDependencies: WorkoutShareArtClipboardDependencies = {
  readBase64: (uri) => new File(uri).base64(),
  setImage: (base64) => Clipboard.setImageAsync(base64),
  isSupported: () => Platform.OS === 'ios' || Platform.OS === 'android',
};

export async function copyWorkoutShareArtToClipboard(
  pngUri: string,
  dependencies: WorkoutShareArtClipboardDependencies = defaultWorkoutShareArtClipboardDependencies,
): Promise<WorkoutShareArtClipboardResult> {
  if (!dependencies.isSupported()) {
    logInfo('workout_share', 'workout_share_art_clipboard_unsupported');
    return 'unsupported';
  }
  try {
    const base64 = await dependencies.readBase64(pngUri);
    await dependencies.setImage(base64);
    logInfo('workout_share', 'workout_share_art_copied');
    return 'copied';
  } catch (error) {
    logWarn('workout_share', 'workout_share_art_copy_failed', { error });
    return 'failed';
  }
}
