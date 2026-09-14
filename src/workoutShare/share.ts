import * as Sharing from 'expo-sharing';

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

export type WorkoutShareResult =
  | { status: 'shared'; destination: 'generic' }
  | { status: 'handedOff'; destination: 'instagram' }
  | { status: 'fallback'; destination: 'generic' }
  | { status: 'unavailable' };

export interface WorkoutShareDependencies {
  isGenericAvailable: () => Promise<boolean>;
  shareGeneric: (uri: string) => Promise<void>;
  getInstagramCapabilities: () => Promise<InstagramStoriesCapabilities>;
  shareInstagram: (uri: string) => Promise<void>;
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
  shareInstagram: async (uri) => {
    if (!nativeInstagram) throw new Error('instagram stories native module unavailable');
    await nativeInstagram.share(uri);
  },
  cleanup: discardWorkoutShareFile,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface WorkoutShareController {
  share(uri: string, destination: 'instagram' | 'generic'): Promise<WorkoutShareResult>;
  isSharing(): boolean;
}

export function createWorkoutShareController(
  dependencies: WorkoutShareDependencies = defaultDependencies,
): WorkoutShareController {
  let active: Promise<WorkoutShareResult> | null = null;

  const generic = async (uri: string, fallback: boolean): Promise<WorkoutShareResult> => {
    if (!await dependencies.isGenericAvailable()) return { status: 'unavailable' };
    await dependencies.shareGeneric(uri);
    await dependencies.delay(GENERIC_SHARE_CLEANUP_GRACE_MS);
    return fallback
      ? { status: 'fallback', destination: 'generic' }
      : { status: 'shared', destination: 'generic' };
  };

  const run = async (
    uri: string,
    destination: 'instagram' | 'generic',
  ): Promise<WorkoutShareResult> => {
    let cleanupScheduled = false;
    try {
      if (destination === 'generic') {
        const result = await generic(uri, false);
        return result;
      }

      try {
        const capabilities = await dependencies.getInstagramCapabilities();
        logInfo('workout_share', 'instagram_stories_capabilities', capabilities);
        if (
          capabilities.instagramInstalled
          && capabilities.schemeAvailable
          && capabilities.sourceApplicationConfigured
        ) {
          await dependencies.shareInstagram(uri);
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
          return { status: 'handedOff', destination: 'instagram' };
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
      const result = await generic(uri, true);
      return result;
    } finally {
      // A direct Instagram handoff owns a delayed lease above. Generic success
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
