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

// Phase 3 intentionally ships no expo-module.config.json or native sources.
// Existing binaries therefore resolve this optional presentation module to
// null. A later native phase can register this exact name and contract.
const nativeModule =
  requireOptionalNativeModule<AJFitRestActivityNativeModule>('AJFitRestActivity');

export function getAJFitRestActivityNativeModule(): AJFitRestActivityNativeModule | null {
  return nativeModule;
}
