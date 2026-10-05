import { requireOptionalNativeModule } from 'expo-modules-core';
import type {
  RestActivityEndReason,
  RestLiveCapabilities,
  WorkoutActivityState,
} from '../../src/types/restLiveActivity';

export type AJFitRestActivityNativeModule = {
  getCapabilities(): RestLiveCapabilities | Promise<RestLiveCapabilities>;
  start(state: WorkoutActivityState): void | Promise<void>;
  update(state: WorkoutActivityState, shouldAlert: boolean): void | Promise<void>;
  end(sessionId: string, reason: RestActivityEndReason): void | Promise<void>;
  /** Optional for compatibility with binaries produced before Phase 7. */
  cleanup?(): void | Promise<void>;
  /** Optional additive hook used only to deduplicate Android's system prompt. */
  recordNotificationPermissionRequest?(): void | Promise<void>;
  /**
   * iOS only. Reads and clears the one-shot flag `AJFitFinishRestIntent`
   * leaves when the Lock Screen "Finalizar descanso" button ran while this
   * app wasn't running. Absent on Android/older binaries.
   */
  consumePendingRestFinish?(sessionId: string): boolean | Promise<boolean>;
  /**
   * iOS only. Reads and clears the accumulated pending seconds
   * `AJFitAddRestSecondsIntent` left when the Lock Screen "+15s" button ran
   * one or more times while this app wasn't running (0 = none).
   */
  consumePendingAddSeconds?(sessionId: string): number | Promise<number>;
};

// This remains optional so older binaries and non-Android platforms keep the
// Phase 3 fail-open behavior when the native presentation module is absent.
const nativeModule =
  requireOptionalNativeModule<AJFitRestActivityNativeModule>('AJFitRestActivity');

export function getAJFitRestActivityNativeModule(): AJFitRestActivityNativeModule | null {
  return nativeModule;
}
