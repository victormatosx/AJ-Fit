import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetSnapshotBuilderInput } from '../widgetSnapshot';

type NativeModuleMock = {
  writeSnapshot: ReturnType<typeof vi.fn<(json: string) => void>>;
  clearSnapshot: ReturnType<typeof vi.fn<() => void>>;
  readSnapshotForDebug: ReturnType<typeof vi.fn<() => string | null>>;
  requestReload: ReturnType<typeof vi.fn<() => void>>;
};

const bridge = vi.hoisted(() => ({ nativeModule: null as NativeModuleMock | null }));

vi.mock('../../../modules/ajfit-widgets', () => ({
  getAJFitWidgetsNativeModule: () => bridge.nativeModule,
}));

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

function inputFor(uid: string, todayLocalDate = '2026-09-09'): WidgetSnapshotBuilderInput {
  // `uid` never enters the snapshot itself — it only tags fixture data in
  // these tests so assertions can tell "which user's write landed" by the
  // *content* written, never by a field on the wire contract.
  return {
    isAuthenticated: true,
    hasActiveProgram: true,
    todayLocalDate,
    timezone: 'America/Sao_Paulo',
    generatedAtMs: 1_000_000,
    trainingDays: ['MON', 'WED', 'FRI'],
    activeRecoveryDays: [],
    activatedAtLocalDate: '2026-08-01',
    dailyActivityStreak: { current: 0, complete: true },
  completedDates: new Set(uid === 'A' ? ['2026-09-07'] : ['2026-09-07', '2026-09-09']),
  };
}

/** A promise the test controls the resolution of — simulates a slow native call. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  bridge.nativeModule = null;
  vi.resetModules();
});

describe('widgetSnapshotSync — write/read/clear roundtrip', () => {
  it('syncWidgetSnapshot writes a JSON-serialized snapshot built from the input', async () => {
    const { syncWidgetSnapshot } = await import('../widgetSnapshotSync');
    const nativeModule = installNativeModule();

    await syncWidgetSnapshot(inputFor('A'));

    expect(nativeModule.writeSnapshot).toHaveBeenCalledTimes(1);
    const written = JSON.parse(nativeModule.writeSnapshot.mock.calls[0][0] as string);
    expect(written.status).toBe('READY');
    expect(written.schemaVersion).toBe(2);
  });

  it('syncWidgetSnapshot also requests a reload after a successful write', async () => {
    const { syncWidgetSnapshot } = await import('../widgetSnapshotSync');
    const nativeModule = installNativeModule();
    await syncWidgetSnapshot(inputFor('A'));
    expect(nativeModule.requestReload).toHaveBeenCalledTimes(1);
  });

  it('clearWidgetSnapshot calls through to the native clear', async () => {
    const { clearWidgetSnapshot } = await import('../widgetSnapshotSync');
    const nativeModule = installNativeModule();
    await clearWidgetSnapshot();
    expect(nativeModule.clearSnapshot).toHaveBeenCalledTimes(1);
  });

  it('clearWidgetSnapshot requests a reload so stale account data disappears', async () => {
    const { clearWidgetSnapshot } = await import('../widgetSnapshotSync');
    const nativeModule = installNativeModule();
    await clearWidgetSnapshot();
    expect(nativeModule.requestReload).toHaveBeenCalledTimes(1);
  });
});

describe('widgetSnapshotSync — race protection (mandatory, see Phase 2 report §8)', () => {
  it('scenario 1: a sync started before logout must not write after clearWidgetSnapshot runs', async () => {
    const { syncWidgetSnapshot, clearWidgetSnapshot } = await import('../widgetSnapshotSync');
    const nativeModule = installNativeModule();

    // Simulate A's resync being slow by building its snapshot synchronously
    // (capturing the generation) but awaiting the actual sync call AFTER
    // logout has already run — this reproduces "A's write lands late".
    const aSync = syncWidgetSnapshot(inputFor('A'));
    await clearWidgetSnapshot(); // logout happens first and wins the queue
    await aSync; // A's late write is processed after, but must be discarded

    expect(nativeModule.clearSnapshot).toHaveBeenCalledTimes(1);
    expect(nativeModule.writeSnapshot).not.toHaveBeenCalled();
  });

  it('scenario 2: B logging in quickly after A logs out is never overwritten by A\'s delayed sync', async () => {
    const { syncWidgetSnapshot, clearWidgetSnapshot } = await import('../widgetSnapshotSync');
    const nativeModule = installNativeModule();

    const aSync = syncWidgetSnapshot(inputFor('A')); // captures A's generation
    await clearWidgetSnapshot(); // A logs out
    const bSync = syncWidgetSnapshot(inputFor('B')); // B logs in, captures the NEW generation
    await Promise.all([aSync, bSync]);

    expect(nativeModule.writeSnapshot).toHaveBeenCalledTimes(1);
    const written = JSON.parse(nativeModule.writeSnapshot.mock.calls[0][0] as string);
    // B's fixture has 2 completed dates vs A's 1 — this is how the test
    // tells the surviving write is B's, not A's, without any uid field.
    expect(written.monthlyActivity.completedLocalDates).toHaveLength(2);
  });

  it('scenario 2b: A\'s sync captured BEFORE logout still cannot land even if awaited after B\'s sync resolves', async () => {
    const { syncWidgetSnapshot, clearWidgetSnapshot } = await import('../widgetSnapshotSync');
    const nativeModule = installNativeModule();

    const aSync = syncWidgetSnapshot(inputFor('A'));
    await clearWidgetSnapshot();
    const bSync = syncWidgetSnapshot(inputFor('B'));
    await bSync;
    await aSync; // resolves after, but was queued (and generation-checked) before B's write

    const writes = nativeModule.writeSnapshot.mock.calls.map((call) => JSON.parse(call[0] as string));
    expect(writes).toHaveLength(1);
    expect(writes[0].monthlyActivity.completedLocalDates).toHaveLength(2); // B's, never A's
  });

  it('scenario 3: two syncs in the SAME session (finalize + foreground) never invalidate each other — both write, last queued wins', async () => {
    const { syncWidgetSnapshot } = await import('../widgetSnapshotSync');
    const nativeModule = installNativeModule();

    // No clearWidgetSnapshot between these — same login session throughout.
    await syncWidgetSnapshot(inputFor('A', '2026-09-09'));
    await syncWidgetSnapshot(inputFor('A', '2026-09-11'));

    expect(nativeModule.writeSnapshot).toHaveBeenCalledTimes(2); // neither was discarded
    const last = JSON.parse(nativeModule.writeSnapshot.mock.calls[1][0] as string);
    expect(last.localDate).toBe('2026-09-11');
  });

  it('concurrent finalize + foreground resync within the same session: the later-queued write is the one left standing', async () => {
    const { syncWidgetSnapshot } = await import('../widgetSnapshotSync');
    const nativeModule = installNativeModule();
    const slowFirstWrite = deferred<void>();
    nativeModule.writeSnapshot
      .mockImplementationOnce(() => slowFirstWrite.promise as unknown as void)
      .mockImplementationOnce(() => undefined);

    const first = syncWidgetSnapshot(inputFor('A', '2026-09-09')); // slow (foreground reconciliation)
    const second = syncWidgetSnapshot(inputFor('A', '2026-09-11')); // fast, queued right after (finalize)
    slowFirstWrite.resolve(undefined);
    await Promise.all([first, second]);

    expect(nativeModule.writeSnapshot).toHaveBeenCalledTimes(2);
    const calls = nativeModule.writeSnapshot.mock.calls.map((call) => JSON.parse(call[0] as string));
    // Both ran, strictly in queue order — the second (finalize) call is the
    // final state, exactly as if they had been simple sequential awaits.
    expect(calls[0].localDate).toBe('2026-09-09');
    expect(calls[1].localDate).toBe('2026-09-11');
  });

  it('a clear queued between two same-session syncs still only blocks writes from BEFORE it, not after', async () => {
    const { syncWidgetSnapshot, clearWidgetSnapshot } = await import('../widgetSnapshotSync');
    const nativeModule = installNativeModule();

    const firstSync = syncWidgetSnapshot(inputFor('A', '2026-09-09'));
    await clearWidgetSnapshot();
    const secondSyncAfterNewLogin = syncWidgetSnapshot(inputFor('A', '2026-09-11'));
    await Promise.all([firstSync, secondSyncAfterNewLogin]);

    expect(nativeModule.clearSnapshot).toHaveBeenCalledTimes(1);
    expect(nativeModule.writeSnapshot).toHaveBeenCalledTimes(1);
    const written = JSON.parse(nativeModule.writeSnapshot.mock.calls[0][0] as string);
    expect(written.localDate).toBe('2026-09-11');
  });
});
