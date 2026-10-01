import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetSnapshotV1 } from '../widgetSnapshot';

type NativeModuleMock = {
  writeSnapshot: ReturnType<typeof vi.fn<(json: string) => void>>;
  clearSnapshot: ReturnType<typeof vi.fn<() => void>>;
  readSnapshotForDebug: ReturnType<typeof vi.fn<() => string | null>>;
  requestReload: ReturnType<typeof vi.fn<() => void>>;
};

const bridge = vi.hoisted(() => ({ nativeModule: null as NativeModuleMock | null }));
const logs = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../../modules/ajfit-widgets', () => ({
  getAJFitWidgetsNativeModule: () => bridge.nativeModule,
}));

vi.mock('../../lib/logger', () => ({ logWarn: logs.warn }));

function installNativeModule(): NativeModuleMock {
  const nativeModule: NativeModuleMock = {
    writeSnapshot: vi.fn(),
    clearSnapshot: vi.fn(),
    readSnapshotForDebug: vi.fn(() => null),
    requestReload: vi.fn(),
  };
  bridge.nativeModule = nativeModule;
  return nativeModule;
}

const READY_SNAPSHOT: WidgetSnapshotV1 = {
  schemaVersion: 1,
  status: 'READY',
  localDate: '2026-10-01',
  generatedAtMs: 1_000_000,
  effectiveAtMs: 999_000,
  futureEntries: [],
  streak: { scheduleMode: 'fixed', unit: 'obligations', current: 3, complete: true },
  weeklyActivity: [],
  monthlyActivity: { year: 2026, month: 10, daysInMonth: 31, startWeekday: 'THU', completedLocalDates: [] },
  frequencyWindow: { startLocalDate: '2026-09-02', endLocalDate: '2026-10-01', startWeekday: 'WED', completedLocalDates: [] },
};

beforeEach(() => {
  bridge.nativeModule = null;
  logs.warn.mockClear();
});

describe('widgetSnapshotBridge', () => {
  it('write → read roundtrip through the native module', async () => {
    const { writeWidgetSnapshotNative, readWidgetSnapshotForDebug } = await import('../widgetSnapshotBridge');
    const nativeModule = installNativeModule();
    nativeModule.readSnapshotForDebug.mockReturnValue(JSON.stringify(READY_SNAPSHOT));

    await writeWidgetSnapshotNative(READY_SNAPSHOT);
    expect(nativeModule.writeSnapshot).toHaveBeenCalledWith(JSON.stringify(READY_SNAPSHOT));

    const raw = await readWidgetSnapshotForDebug();
    expect(raw && JSON.parse(raw)).toEqual(READY_SNAPSHOT);
  });

  it('clear calls through to the native module', async () => {
    const { clearWidgetSnapshotNative } = await import('../widgetSnapshotBridge');
    const nativeModule = installNativeModule();
    await clearWidgetSnapshotNative();
    expect(nativeModule.clearSnapshot).toHaveBeenCalledTimes(1);
  });

  it('requestReload calls through to the native module', async () => {
    const { requestWidgetReloadNative } = await import('../widgetSnapshotBridge');
    const nativeModule = installNativeModule();
    await requestWidgetReloadNative();
    expect(nativeModule.requestReload).toHaveBeenCalledTimes(1);
  });

  it('every call fails open (no throw) when the native module is absent — older binary / unsupported platform', async () => {
    const { writeWidgetSnapshotNative, clearWidgetSnapshotNative, readWidgetSnapshotForDebug, requestWidgetReloadNative } =
      await import('../widgetSnapshotBridge');
    bridge.nativeModule = null;

    await expect(writeWidgetSnapshotNative(READY_SNAPSHOT)).resolves.toBeUndefined();
    await expect(clearWidgetSnapshotNative()).resolves.toBeUndefined();
    await expect(readWidgetSnapshotForDebug()).resolves.toBeNull();
    await expect(requestWidgetReloadNative()).resolves.toBeUndefined();
  });

  it('a throwing native call is caught and logged, never propagated', async () => {
    const { writeWidgetSnapshotNative } = await import('../widgetSnapshotBridge');
    const nativeModule = installNativeModule();
    nativeModule.writeSnapshot.mockImplementation(() => {
      throw new Error('native boom');
    });

    await expect(writeWidgetSnapshotNative(READY_SNAPSHOT)).resolves.toBeUndefined();
    expect(logs.warn).toHaveBeenCalledWith('widget_snapshot_bridge', 'native_call_failed', expect.objectContaining({
      operation: 'writeSnapshot',
    }));
  });
});
