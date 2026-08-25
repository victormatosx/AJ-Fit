import { requireOptionalNativeModule } from 'expo-modules-core';
import type {
  RestActivityEndReason,
  RestActivityState,
  RestLiveCapabilities,
} from '../../src/types/restLiveActivity';

export type AJFitRestActivityNativeModule = {
  getCapabilities(): RestLiveCapabilities | Promise<RestLiveCapabilities>;
  start(state: RestActivityState): void | Promise<void>;
  update(state: RestActivityState): void | Promise<void>;
  end(sessionId: string, reason: RestActivityEndReason): void | Promise<void>;
};

// This remains optional so older binaries and non-Android platforms keep the
// Phase 3 fail-open behavior when the native presentation module is absent.
const nativeModule =
  requireOptionalNativeModule<AJFitRestActivityNativeModule>('AJFitRestActivity');

export function getAJFitRestActivityNativeModule(): AJFitRestActivityNativeModule | null {
  return nativeModule;
}
