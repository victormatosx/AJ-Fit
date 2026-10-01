import { logWarn } from '../lib/logger';
import { getAJFitWidgetsNativeModule } from '../../modules/ajfit-widgets';
import type { WidgetSnapshotV1 } from './widgetSnapshot';

/**
 * Thinnest possible layer over the native module: serialize/deserialize
 * JSON and fail open (never throw) when the native module is absent (older
 * binary, unsupported platform — same contract `ajfit-rest-activity` uses)
 * or a call rejects. No race protection lives here — see
 * `widgetSnapshotSync.ts` for the generation/serialization guarantees
 * required by concurrent login/logout/finalize/foreground events.
 */

async function callNative<T>(operation: string, run: () => T | Promise<T>): Promise<T | null> {
  const nativeModule = getAJFitWidgetsNativeModule();
  if (!nativeModule) return null;
  try {
    return await Promise.resolve(run());
  } catch (error) {
    logWarn('widget_snapshot_bridge', 'native_call_failed', { operation, error });
    return null;
  }
}

/** Overwrites the one stored snapshot. No-op (logged) if the native module is unavailable. */
export async function writeWidgetSnapshotNative(snapshot: WidgetSnapshotV1): Promise<void> {
  await callNative('writeSnapshot', () => {
    const nativeModule = getAJFitWidgetsNativeModule();
    return nativeModule?.writeSnapshot(JSON.stringify(snapshot));
  });
}

/** Removes the stored snapshot entirely — the "no data" state. */
export async function clearWidgetSnapshotNative(): Promise<void> {
  await callNative('clearSnapshot', () => {
    const nativeModule = getAJFitWidgetsNativeModule();
    return nativeModule?.clearSnapshot();
  });
}

/** QA/debug only. Returns the raw, unparsed stored string, or `null` if absent/unavailable. */
export async function readWidgetSnapshotForDebug(): Promise<string | null> {
  return callNative('readSnapshotForDebug', () => {
    const nativeModule = getAJFitWidgetsNativeModule();
    return nativeModule?.readSnapshotForDebug() ?? null;
  });
}

/**
 * Phase 2 abstraction point for Phase 3/4 — see `modules/ajfit-widgets`'s
 * native implementations for why iOS does something real today while
 * Android is currently a documented no-op.
 */
export async function requestWidgetReloadNative(): Promise<void> {
  await callNative('requestReload', () => {
    const nativeModule = getAJFitWidgetsNativeModule();
    return nativeModule?.requestReload();
  });
}
