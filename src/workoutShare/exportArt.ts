import type { RefObject } from 'react';
import { File } from 'expo-file-system';
import { PixelRatio, type View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import { createWorkoutShareExportUri, discardWorkoutShareFile } from './files';
import { workoutShareCaptureSize } from './export';

function fileUri(uri: string): string {
  if (uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  throw new Error('invalid view-shot uri');
}

/**
 * The *logical* size (RN points on iOS, dp on Android) an ARTE poster must
 * actually be laid out/rendered at — as opposed to `workoutShareCaptureSize`,
 * which is the size passed to `captureRef`'s own `width`/`height` options.
 *
 * Why two different functions for what looks like the same math: neither
 * native capture implementation re-renders a view at a size you merely pass
 * as an option.
 * - iOS (`RNViewShot.mm`): draws the view's *current* layer tree into a
 *   `UIGraphicsImageRenderer` context sized to the given `width`/`height`
 *   (points) via `drawViewHierarchyInRect:`, which scales to fit — so if the
 *   view's actual on-screen bounds are smaller than that target rect, this
 *   is a stretch of already-small content, not a sharper re-render.
 * - Android (`ViewShot.java`): captures the view at its *actual current*
 *   `getWidth()/getHeight()` into a bitmap, then calls
 *   `Bitmap.createScaledBitmap(bitmap, width, height, true)` — a plain
 *   bilinear bitmap resize from whatever the view's real on-screen size was.
 *
 * On both platforms, asking for a bigger export than the view's actual
 * layout size produces an *upscaled, blurry* capture — exactly the bug this
 * function exists to prevent. The fix is to never resize at all: lay the
 * poster out, off-screen, at this logical size (always `exportPixels /
 * PixelRatio.get()`, on both platforms — Android's RN layout is in dp, and
 * `view.getWidth()` in native pixels equals `dp * density`, which is the
 * same `PixelRatio.get()` value from JS) so its *native* on-screen rendering
 * resolution already equals the export target, making the subsequent
 * resize-to-`workoutShareCaptureSize` a same-size, lossless passthrough
 * instead of an upscale.
 */
export function workoutShareArtRenderSize(
  exportWidth: number,
  exportHeight: number,
  pixelRatio: number = PixelRatio.get(),
): { width: number; height: number } {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return { width: exportWidth / ratio, height: exportHeight / ratio };
}

/**
 * Captures an "ARTE" poster as a real transparent PNG — the ARTE-mode
 * counterpart to `captureWorkoutSharePoster` (which is permanently JPEG,
 * since every FOTO poster paints a full-bleed opaque background). There is
 * no `quality` option here: PNG is lossless, and `captureRef` ignores
 * `quality` for that format anyway.
 *
 * `posterRef` must point to a poster already laid out at
 * `workoutShareArtRenderSize(exportSize.width, exportSize.height)` — never
 * the small on-screen preview instance — or this just reproduces the
 * upscale-blur bug described above. See `WorkoutShareComposer`'s dedicated
 * off-screen HD export stage.
 *
 * Transparency itself is NOT a capture-time flag — it falls straight out of
 * the poster never setting a `backgroundColor` on its root `View`. If a
 * poster regresses and paints an opaque background, this still produces a
 * valid PNG, just not a transparent one; that invariant belongs to the
 * poster components, not this function (see the ARTE poster structural
 * test).
 */
export async function captureWorkoutShareArt(
  posterRef: RefObject<View | null>,
  exportSize: { width: number; height: number },
): Promise<string> {
  if (!posterRef.current) throw new Error('workout share art poster is not ready');
  let shotUri: string | null = null;
  let exportUri: string | null = null;
  try {
    const size = workoutShareCaptureSize(exportSize.width, exportSize.height);
    shotUri = await captureRef(posterRef, {
      ...size,
      format: 'png',
      result: 'tmpfile',
    });
    exportUri = createWorkoutShareExportUri('png');
    const source = new File(fileUri(shotUri));
    const target = new File(exportUri);
    if (!source.exists || (source.size ?? 0) <= 0) throw new Error('empty workout share art capture');
    await source.copy(target);
    if (!target.exists || (target.size ?? 0) <= 0) throw new Error('empty workout share art export');
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
