import { requireOptionalNativeModule } from 'expo-modules-core';

export type AJFitInstagramStoriesNativeModule = {
  getCapabilities?(): InstagramStoriesCapabilities | Promise<InstagramStoriesCapabilities>;
  isAvailable(): boolean | Promise<boolean>;
  share(uri: string): void | Promise<void>;
  /** iOS-only: the Android native module does not implement Instagram feed sharing. */
  isInstagramAppAvailable?(): boolean | Promise<boolean>;
  /** iOS-only: the Android native module does not implement Instagram feed sharing. */
  shareToFeed?(uri: string): void | Promise<void>;
};

export type InstagramStoriesCapabilities = {
  instagramInstalled: boolean;
  schemeAvailable: boolean;
  sourceApplicationConfigured: boolean;
};

const nativeModule = requireOptionalNativeModule<AJFitInstagramStoriesNativeModule>(
  'AJFitInstagramStories',
);

export function getAJFitInstagramStoriesNativeModule(): AJFitInstagramStoriesNativeModule | null {
  return nativeModule;
}
