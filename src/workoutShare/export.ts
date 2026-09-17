import type { RefObject } from 'react';
import { File } from 'expo-file-system';
import { PixelRatio, Platform, type View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import { createWorkoutShareExportUri, discardWorkoutShareFile } from './files';

export const WORKOUT_SHARE_EXPORT_QUALITY = 0.92;

/**
 * Converts a layout's target export pixels (e.g. the Classic layout's
 * 1080x1920) into the size `captureRef` must be asked for. Android already
 * captures in physical pixels; iOS's `captureRef` multiplies the requested
 * size by the device pixel ratio internally, so it must be asked in points.
 */
export function workoutShareCaptureSize(
  exportWidth: number,
  exportHeight: number,
  platform: typeof Platform.OS = Platform.OS,
  pixelRatio = PixelRatio.get(),
): { width: number; height: number } {
  if (platform === 'ios') {
    const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
    return { width: exportWidth / ratio, height: exportHeight / ratio };
  }
  return { width: exportWidth, height: exportHeight };
}

function fileUri(uri: string): string {
  if (uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  throw new Error('invalid view-shot uri');
}

export async function captureWorkoutSharePoster(
  posterRef: RefObject<View | null>,
  exportSize: { width: number; height: number },
): Promise<string> {
  if (!posterRef.current) throw new Error('workout share poster is not ready');
  let shotUri: string | null = null;
  let exportUri: string | null = null;
  try {
    const size = workoutShareCaptureSize(exportSize.width, exportSize.height);
    shotUri = await captureRef(posterRef, {
      ...size,
      format: 'jpg',
      quality: WORKOUT_SHARE_EXPORT_QUALITY,
      result: 'tmpfile',
    });
    exportUri = createWorkoutShareExportUri();
    const source = new File(fileUri(shotUri));
    const target = new File(exportUri);
    if (!source.exists || (source.size ?? 0) <= 0) throw new Error('empty workout share capture');
    await source.copy(target);
    if (!target.exists || (target.size ?? 0) <= 0) throw new Error('empty workout share export');
    return exportUri;
  } catch (error) {
    discardWorkoutShareFile(exportUri);
    throw error;
  } finally {
    if (shotUri) {
      try { releaseCapture(shotUri); } catch { /* view-shot owns this file. */ }
    }
  }
}
