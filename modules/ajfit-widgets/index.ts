import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Deliberately tiny — this module has zero business logic. It receives an
 * already-serialized `WidgetSnapshotV1` JSON string (built in TypeScript —
 * see `src/widgets/widgetSnapshot.ts`) and persists/clears/reads it from the
 * platform-appropriate shared storage (iOS: `UserDefaults(suiteName:
 * "group.com.ajfit.app.widgets")`; Android: a dedicated `SharedPreferences`
 * file — see `src/widgets/widgetSnapshotBridge.ts` for why each was chosen).
 * It never calls Firestore, never computes a streak, never classifies a
 * day's status, and never knows what `uid`/`ScheduleConfig` are.
 */
export type AJFitWidgetsNativeModule = {
  /** Persists `json` as the one current snapshot. Overwrites whatever was there. */
  writeSnapshot(json: string): void | Promise<void>;
  /** Removes the snapshot entirely — the "no data" state, not an empty JSON blob. */
  clearSnapshot(): void | Promise<void>;
  /** QA/debug only — returns the raw stored string (or `null`), unparsed. Never used by production UI. */
  readSnapshotForDebug(): (string | null) | Promise<string | null>;
  /**
   * Phase 2 abstraction point for Phase 3/4: asks the OS to refresh any
   * registered widget timelines. iOS implements this for real today
   * (`WidgetCenter.shared.reloadAllTimelines()` is harmless with zero
   * registered widget kinds). Android is intentionally a no-op until a
   * Glance receiver exists to update — see the Kotlin implementation's doc
   * comment.
   */
  requestReload(): void | Promise<void>;
};

// Optional, like `ajfit-rest-activity`'s module accessor: a missing native
// module (older binary, unsupported platform) must fail open, never crash.
const nativeModule = requireOptionalNativeModule<AJFitWidgetsNativeModule>('AJFitWidgets');

export function getAJFitWidgetsNativeModule(): AJFitWidgetsNativeModule | null {
  return nativeModule;
}
