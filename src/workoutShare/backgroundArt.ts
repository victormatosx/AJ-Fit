import { useSyncExternalStore } from 'react';
import { Image, type ImageRef, type ImageSource } from 'expo-image';

// Same shared-require pattern as `logo.ts` — one reference reused by every
// reader instead of each poster resolving its own `require()`.
export const WORKOUT_SHARE_GYM_ART_SOURCE: ImageSource = require('../../assets/share-workout/gym.png');

let gymArtRef: ImageRef | null = null;
let loadPromise: Promise<ImageRef> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Decodes the fixed gym background artwork (PosterCreative's BodyMap panel)
 * exactly once and caches the resulting `ImageRef` in module scope. Call
 * this as soon as the share composer mounts — PosterCreative is windowed
 * (mounted/unmounted as the carousel swipes), so without this cache every
 * remount would re-decode the same background from scratch.
 */
export function preloadWorkoutShareGymArt(): Promise<ImageRef> {
  if (!loadPromise) {
    loadPromise = Image.loadAsync(WORKOUT_SHARE_GYM_ART_SOURCE).then((ref) => {
      gymArtRef = ref;
      notify();
      return ref;
    });
  }
  return loadPromise;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Returns the preloaded `ImageRef` once available (renders immediately, no
 * async gap), falling back to the raw `require()` source until then.
 */
export function useWorkoutShareGymArtSource(): ImageSource | ImageRef {
  const ref = useSyncExternalStore(subscribe, () => gymArtRef, () => gymArtRef);
  return ref ?? WORKOUT_SHARE_GYM_ART_SOURCE;
}
