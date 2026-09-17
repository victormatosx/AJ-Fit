import { useSyncExternalStore } from 'react';
import { Image, type ImageRef, type ImageSource } from 'expo-image';

// One shared require — Metro already dedupes this by module id, but a single
// exported reference guarantees every poster passes the exact same value
// (and the exact same fallback) instead of six independent `require()` calls.
export const AJ_LOGO_SOURCE: ImageSource = require('../../assets/aj-logo.png');

const WHITE_TINT = '#FFFFFF';

// Two caches, not one: PosterSocial/PosterCreative need the logo tinted
// white for their dark footer, and expo-image bakes a tint into the decoded
// `ImageRef` at load time — the runtime `tintColor` prop on `<Image>` isn't
// reliably honored once the source is already a resolved ref (see
// expo-image's own note on `useImage`-sourced refs). So the white variant is
// preloaded separately, tinted at decode time, rather than tinted at render
// time on top of the shared default-color ref.
let logoRef: ImageRef | null = null;
let logoWhiteRef: ImageRef | null = null;
let loadPromise: Promise<ImageRef> | null = null;
let loadWhitePromise: Promise<ImageRef> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Decodes the AJ Fit logo (default color) exactly once and caches the
 * resulting `ImageRef` in module scope. Call this as soon as the share
 * composer mounts; every poster then reads the same cached ref via
 * `useAjLogoSource`, so switching between layouts never re-decodes or
 * re-fetches the asset.
 */
export function preloadAjLogo(): Promise<ImageRef> {
  if (!loadPromise) {
    loadPromise = Image.loadAsync(AJ_LOGO_SOURCE).then((ref) => {
      logoRef = ref;
      notify();
      return ref;
    });
  }
  return loadPromise;
}

/** Same as `preloadAjLogo`, but decodes the white-tinted variant used by the footer wordmark designs. */
export function preloadAjLogoWhite(): Promise<ImageRef> {
  if (!loadWhitePromise) {
    loadWhitePromise = Image.loadAsync(AJ_LOGO_SOURCE, { tintColor: WHITE_TINT }).then((ref) => {
      logoWhiteRef = ref;
      notify();
      return ref;
    });
  }
  return loadWhitePromise;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Returns the preloaded `ImageRef` once available (renders immediately, no
 * async gap), falling back to the raw `require()` source until then — e.g.
 * a poster mounted before `preloadAjLogo()` resolved.
 */
export function useAjLogoSource(): ImageSource | ImageRef {
  const ref = useSyncExternalStore(subscribe, () => logoRef, () => logoRef);
  return ref ?? AJ_LOGO_SOURCE;
}

/**
 * Same as `useAjLogoSource`, but for the white-tinted variant. Falls back to
 * the raw (untinted) source plus the `tintColor` prop on `<Image>` until the
 * preloaded white ref is ready.
 */
export function useAjLogoWhiteSource(): ImageSource | ImageRef {
  const ref = useSyncExternalStore(subscribe, () => logoWhiteRef, () => logoWhiteRef);
  return ref ?? AJ_LOGO_SOURCE;
}
