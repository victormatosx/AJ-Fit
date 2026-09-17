import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import {
  getAJFitInstagramStoriesNativeModule,
  type InstagramStoriesCapabilities,
} from '../../modules/ajfit-instagram-stories';
import { logInfo, logWarn } from '../lib/logger';
import { discardWorkoutShareFile } from './files';

export const WORKOUT_SHARE_MIME_TYPE = 'image/jpeg';
export const WORKOUT_SHARE_UTI = 'public.jpeg';
export const GENERIC_SHARE_CLEANUP_GRACE_MS = 1_000;
export const INSTAGRAM_SHARE_CLEANUP_GRACE_MS = 60_000;
/**
 * Instagram Stories/Feed are the only destinations that still attempt a
 * direct native app handoff before ever falling back to the generic sheet.
 * Some devices/OS versions never settle that handoff promise at all —
 * without a timeout the composer would stay stuck in "loading" forever,
 * since nothing would ever reach the fallback-to-generic-sheet catch block.
 */
export const INSTAGRAM_HANDOFF_TIMEOUT_MS = 8_000;
/**
 * Safety net for the generic sheet itself (`expo-sharing`'s
 * `UIActivityViewController`/Android chooser). Not a UX timer — the sheet is
 * expected to legitimately stay open for as long as the user is browsing
 * it, and this only guards against iOS/Android silently dropping the
 * present/launch call (e.g. a `present()` issued while another sheet is
 * still mid-dismissal) and never firing a completion callback. Kept short
 * relative to the old 45s: WhatsApp/Facebook/TikTok/Outro no longer attempt
 * any direct handoff first, so the generic sheet is now the *first* UI
 * shown for them, not a second sheet racing a just-cancelled one — the
 * scenario that motivated the longer value is now confined to the Instagram
 * Stories/Feed fallback path, which still uses it.
 */
export const GENERIC_SHARE_HANDOFF_TIMEOUT_MS = 20_000;

class WorkoutShareHandoffTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} handoff timed out after ${ms}ms`);
    this.name = 'WorkoutShareHandoffTimeoutError';
  }
}

function withHandoffTimeout<T>(promise: Promise<T>, label: string, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new WorkoutShareHandoffTimeoutError(label, ms)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Product rule: only Instagram Stories and Instagram Feed ever attempt a
 * direct native handoff. WhatsApp, Facebook, TikTok, and "Outro" always open
 * the OS's own generic share sheet — the user picks the destination app
 * from there. `destination` still flows into `generic()` for logging/UI
 * only; it never selects different native behavior for these four.
 */
export type WorkoutShareDestination =
  | 'instagramStories'
  | 'instagram'
  | 'tiktok'
  | 'facebook'
  | 'whatsapp'
  | 'generic';

export type WorkoutShareResult =
  | { status: 'shared'; destination: 'generic' }
  | { status: 'handedOff'; destination: 'instagramStories' | 'instagram' }
  | { status: 'fallback'; destination: 'generic' }
  | { status: 'unavailable' };

export interface WorkoutShareDependencies {
  isGenericAvailable: () => Promise<boolean>;
  shareGeneric: (uri: string) => Promise<void>;
  getInstagramCapabilities: () => Promise<InstagramStoriesCapabilities>;
  shareInstagramStories: (uri: string) => Promise<void>;
  /** Static capability, not a permission/install check — true only when the native module exposes the iOS-only `shareToFeed`/`isInstagramAppAvailable` pair. Android always reports `false` and falls straight to the generic sheet. */
  isInstagramFeedNativeSupported: () => boolean;
  isInstagramAppAvailable: () => Promise<boolean>;
  shareInstagramFeed: (uri: string) => Promise<void>;
  cleanup: (uri: string) => void;
  delay: (ms: number) => Promise<void>;
}

const nativeInstagram = getAJFitInstagramStoriesNativeModule();

const defaultDependencies: WorkoutShareDependencies = {
  isGenericAvailable: () => Sharing.isAvailableAsync(),
  shareGeneric: (uri) => Sharing.shareAsync(uri, {
    mimeType: WORKOUT_SHARE_MIME_TYPE,
    UTI: WORKOUT_SHARE_UTI,
  }),
  getInstagramCapabilities: async () => {
    if (!nativeInstagram?.getCapabilities) {
      // An older Development Build cannot prove source_application is
      // configured, so direct Stories must fail closed to the generic sheet.
      return {
        instagramInstalled: false,
        schemeAvailable: false,
        sourceApplicationConfigured: false,
      };
    }
    return await nativeInstagram.getCapabilities();
  },
  shareInstagramStories: async (uri) => {
    if (!nativeInstagram) throw new Error('instagram stories native module unavailable');
    await nativeInstagram.share(uri);
  },
  isInstagramFeedNativeSupported: () =>
    Platform.OS === 'ios' && typeof nativeInstagram?.shareToFeed === 'function',
  isInstagramAppAvailable: async () => {
    if (!nativeInstagram?.isInstagramAppAvailable) return false;
    return Boolean(await nativeInstagram.isInstagramAppAvailable());
  },
  shareInstagramFeed: async (uri) => {
    if (!nativeInstagram?.shareToFeed) throw new Error('instagram feed native module unavailable');
    await nativeInstagram.shareToFeed(uri);
  },
  cleanup: discardWorkoutShareFile,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface WorkoutShareController {
  share(uri: string, destination: WorkoutShareDestination): Promise<WorkoutShareResult>;
  isSharing(): boolean;
}

export function createWorkoutShareController(
  dependencies: WorkoutShareDependencies = defaultDependencies,
): WorkoutShareController {
  let active: Promise<WorkoutShareResult> | null = null;

  const generic = async (
    uri: string,
    destination: WorkoutShareDestination,
    isFallback: boolean,
    markCleanupScheduled: () => void,
  ): Promise<WorkoutShareResult> => {
    logInfo('workout_share', 'generic_share_start', { destination, isFallback });
    if (!await dependencies.isGenericAvailable()) {
      logInfo('workout_share', 'generic_share_unavailable', { destination });
      return { status: 'unavailable' };
    }
    try {
      await withHandoffTimeout(
        dependencies.shareGeneric(uri),
        'generic_share',
        GENERIC_SHARE_HANDOFF_TIMEOUT_MS,
      );
    } catch (error) {
      // Only the timeout is treated as "can't tell what happened, but must
      // still unblock the composer" — a real, immediate rejection from
      // shareGeneric (bad file, no presenter, etc.) is a genuine failure and
      // must keep propagating as one.
      if (!(error instanceof WorkoutShareHandoffTimeoutError)) throw error;
      // The native sheet's own completion handler never fired within the
      // safety window. We can't tell whether it's still on screen, so the
      // temp file gets a long grace lease instead of being deleted here —
      // but the composer must not stay in loading forever.
      logWarn('workout_share', 'generic_share_handoff_timeout', { destination, error });
      markCleanupScheduled();
      void dependencies.delay(INSTAGRAM_SHARE_CLEANUP_GRACE_MS).then(
        () => dependencies.cleanup(uri),
        () => dependencies.cleanup(uri),
      );
      return isFallback
        ? { status: 'fallback', destination: 'generic' }
        : { status: 'shared', destination: 'generic' };
    }
    logInfo('workout_share', 'generic_share_resolved', { destination });
    await dependencies.delay(GENERIC_SHARE_CLEANUP_GRACE_MS);
    return isFallback
      ? { status: 'fallback', destination: 'generic' }
      : { status: 'shared', destination: 'generic' };
  };

  const run = async (
    uri: string,
    destination: WorkoutShareDestination,
  ): Promise<WorkoutShareResult> => {
    let cleanupScheduled = false;
    try {
      // Product rule: WhatsApp, Facebook, TikTok, and "Outro" always open
      // the OS's own share sheet — no per-app branch, no direct handoff
      // attempt. The user picks the destination app themselves from there.
      if (
        destination === 'generic'
        || destination === 'tiktok'
        || destination === 'facebook'
        || destination === 'whatsapp'
      ) {
        return await generic(uri, destination, false, () => { cleanupScheduled = true; });
      }

      if (destination === 'instagramStories') {
        try {
          const capabilities = await dependencies.getInstagramCapabilities();
          logInfo('workout_share', 'instagram_stories_capabilities', capabilities);
          if (
            capabilities.instagramInstalled
            && capabilities.schemeAvailable
            && capabilities.sourceApplicationConfigured
          ) {
            await withHandoffTimeout(
              dependencies.shareInstagramStories(uri),
              'instagram_stories',
              INSTAGRAM_HANDOFF_TIMEOUT_MS,
            );
            // Android's receiving activity may read the granted content URI
            // shortly after startActivity returns. Lease the file without
            // freezing the composer UI for the entire grace interval.
            cleanupScheduled = true;
            void dependencies.delay(INSTAGRAM_SHARE_CLEANUP_GRACE_MS).then(
              () => dependencies.cleanup(uri),
              () => dependencies.cleanup(uri),
            );
            // Neither iOS nor Android reports whether Instagram accepted the
            // payload into its editor. This only confirms the OS handoff.
            return { status: 'handedOff', destination: 'instagramStories' };
          }
          logInfo('workout_share', 'instagram_stories_fallback', {
            reason: !capabilities.sourceApplicationConfigured
              ? 'source_application_unconfigured'
              : 'instagram_unavailable',
          });
        } catch (error) {
          // A stale install query or failed native handoff degrades to the sheet.
          logWarn('workout_share', 'instagram_stories_handoff_failed_fallback', { error });
        }
        return await generic(uri, destination, true, () => { cleanupScheduled = true; });
      }

      // Only `destination === 'instagram'` (feed) remains. iOS: try the
      // native module (saves to Photos under add-only permission, opens
      // Instagram via the resulting `localIdentifier`). Android has no
      // native feed support, so it falls straight to the generic sheet.
      if (dependencies.isInstagramFeedNativeSupported()) {
        try {
          const available = await dependencies.isInstagramAppAvailable();
          logInfo('workout_share', 'instagram_feed_capabilities', { available });
          if (available) {
            await withHandoffTimeout(
              dependencies.shareInstagramFeed(uri),
              'instagram_feed',
              INSTAGRAM_HANDOFF_TIMEOUT_MS,
            );
            // The image now also lives in the user's Photos library as a
            // new asset; Instagram reads it asynchronously after the
            // handoff, so the same generous grace window as Stories applies
            // to our own temp-file cleanup here.
            cleanupScheduled = true;
            void dependencies.delay(INSTAGRAM_SHARE_CLEANUP_GRACE_MS).then(
              () => dependencies.cleanup(uri),
              () => dependencies.cleanup(uri),
            );
            return { status: 'handedOff', destination: 'instagram' };
          }
          logInfo('workout_share', 'instagram_feed_unavailable', {});
        } catch (error) {
          logWarn('workout_share', 'instagram_feed_handoff_failed_fallback', { error });
        }
      }
      return await generic(uri, destination, true, () => { cleanupScheduled = true; });
    } finally {
      // A direct handoff above owns its own delayed lease. Generic success
      // has already waited for the native sheet plus its short grace period;
      // errors have no receiver and are safe to clean synchronously.
      if (!cleanupScheduled) dependencies.cleanup(uri);
    }
  };

  return {
    share(uri, destination) {
      if (active) return active;
      const operation = run(uri, destination);
      active = operation;
      const settle = () => {
        if (active === operation) active = null;
      };
      void operation.then(settle, settle);
      return operation;
    },
    isSharing: () => active !== null,
  };
}
