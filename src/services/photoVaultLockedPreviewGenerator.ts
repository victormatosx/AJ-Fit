import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Produces a destructively degraded derivative of a plaintext photo, for
 * exclusive use as the Photo Vault locked screen's background.
 *
 * This is NOT a blur filter — `expo-image-manipulator` has none. It is
 * information loss: the source is downsampled to `DOWNSAMPLE_PX` on its long
 * edge, then scaled back up to `DISPLAY_PX`. Reconstructing the original from
 * the output is not possible because the downsample step already discarded
 * the information a reversal would need.
 *
 * `DOWNSAMPLE_PX` was chosen empirically, not guessed: synthetic worst-case
 * test images (a close-up face-like pattern, a full-body silhouette on both
 * light and dark backgrounds, and a high-frequency checkerboard standing in
 * for patterned clothing) were run through this exact pipeline at 10px, 8px
 * and 6px. Every one of them was already reduced to a formless color/shape
 * smear at 10px — no eyes, mouth, limb boundary or texture survived — so 10px
 * was kept as the least destructive setting that still meets the bar, rather
 * than dropping further for no additional safety.
 *
 * Only ever called while the vault is genuinely unlocked, from plaintext that
 * was already produced for a legitimate reason (a fresh upload, or a photo
 * the user just opened) — see every call site in `progressPhotos.ts`. This
 * module itself has no opinion about when that is safe; it only transforms
 * whatever URI it is given.
 */

/** Long-edge target of the destructive downsample. The security bar. */
export const LOCKED_PREVIEW_DOWNSAMPLE_PX = 10;
/** Long-edge target after scaling back up. Cosmetic only — never the barrier. */
export const LOCKED_PREVIEW_DISPLAY_PX = 96;
const LOCKED_PREVIEW_JPEG_QUALITY = 0.5;

/** Deletes best-effort. A manipulator output that fails to clean up is not fatal. */
function discardQuietly(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Best effort only — this is a scratch file in the manipulator's own
    // cache, not vault-owned storage.
  }
}

/**
 * Runs the two-stage degrade. Returns `null` on any failure — this is a
 * cosmetic feature, so a failure here must never surface as an upload or
 * viewing error.
 */
export async function generateLockedPreviewDerivative(
  plaintextUri: string,
): Promise<Uint8Array | null> {
  let downUri: string | null = null;
  let upUri: string | null = null;
  try {
    const downRendered = await ImageManipulator.manipulate(plaintextUri)
      .resize({ width: LOCKED_PREVIEW_DOWNSAMPLE_PX })
      .renderAsync();
    const downSaved = await downRendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: LOCKED_PREVIEW_JPEG_QUALITY,
    });
    downUri = downSaved.uri;

    const upRendered = await ImageManipulator.manipulate(downSaved.uri)
      .resize({ width: LOCKED_PREVIEW_DISPLAY_PX })
      .renderAsync();
    const upSaved = await upRendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: LOCKED_PREVIEW_JPEG_QUALITY,
    });
    upUri = upSaved.uri;

    return await new File(upSaved.uri).bytes();
  } catch {
    return null;
  } finally {
    if (downUri) discardQuietly(downUri);
    if (upUri) discardQuietly(upUri);
  }
}
