import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RestActivityEndReason,
  RestActivityState,
  RestLiveCapabilities,
} from '../../types/restLiveActivity';
import {
  REST_ACTIVITY_NEXT_ACTION,
  REST_ACTIVITY_PHASE,
} from '../../types/restLiveActivity';

type NativeModuleMock = {
  getCapabilities: ReturnType<typeof vi.fn<() => Promise<RestLiveCapabilities>>>;
  start: ReturnType<typeof vi.fn<(state: RestActivityState) => Promise<void>>>;
  update: ReturnType<
    typeof vi.fn<(state: RestActivityState, shouldAlert: boolean) => Promise<void>>
  >;
  cleanup?: ReturnType<typeof vi.fn<() => Promise<void>>>;
  end: ReturnType<
    typeof vi.fn<(sessionId: string, reason: RestActivityEndReason) => Promise<void>>
  >;
};

const bridge = vi.hoisted(() => ({
  nativeModule: null as NativeModuleMock | null,
}));

const logs = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../modules/ajfit-rest-activity', () => ({
  getAJFitRestActivityNativeModule: () => bridge.nativeModule,
}));

vi.mock('../logger', () => ({
  logInfo: logs.info,
  logWarn: logs.warn,
}));

const BASE_STATE: RestActivityState = {
  sessionId: 'workout-session-1',
  startedAt: 100_000,
  endsAt: 190_000,
  exerciseName: 'Supino reto',
  setIndex: 1,
  totalSets: 4,
  phase: REST_ACTIVITY_PHASE.RESTING,
  nextAction: REST_ACTIVITY_NEXT_ACTION.NEXT_SET,
  nextSetIndex: 2,
};

function installNativeModule(
  capabilities: RestLiveCapabilities = {
    available: true,
    surface: 'android-notification',
  },
): NativeModuleMock {
  const nativeModule: NativeModuleMock = {
    getCapabilities: vi.fn(async () => capabilities),
    start: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => undefined),
  };
  bridge.nativeModule = nativeModule;
  return nativeModule;
}

async function loadFacade() {
  return (await import('../restLiveActivity')).restLiveActivity;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  bridge.nativeModule = null;
});

describe('restLiveActivity optional capabilities', () => {
  it('reports no capability when the optional native module is absent', async () => {
    const facade = await loadFacade();
    await expect(facade.getCapabilities()).resolves.toEqual({
      available: false,
      surface: 'none',
    });
  });

  it('keeps start, update and end as safe no-ops without a native module', async () => {
    const facade = await loadFacade();
    await expect(facade.start(BASE_STATE)).resolves.toBeUndefined();
    await expect(facade.update({ ...BASE_STATE, endsAt: 205_000 })).resolves.toBeUndefined();
    await expect(facade.end('cancelled')).resolves.toBeUndefined();
    await expect(facade.cleanup()).resolves.toBeUndefined();
  });

  it('reports the real Android notification capability from the native module', async () => {
    const nativeModule = installNativeModule();
    const facade = await loadFacade();

    await expect(facade.getCapabilities()).resolves.toEqual({
      available: true,
      surface: 'android-notification',
    });
    expect(nativeModule.getCapabilities).toHaveBeenCalledTimes(1);
  });

  it('reports the real iOS Live Activity capability from the native module', async () => {
    const nativeModule = installNativeModule({
      available: true,
      surface: 'ios-live-activity',
    });
    const facade = await loadFacade();

    await expect(facade.getCapabilities()).resolves.toEqual({
      available: true,
      surface: 'ios-live-activity',
    });
    expect(nativeModule.getCapabilities).toHaveBeenCalledTimes(1);
  });
});

describe('restLiveActivity temporal contract', () => {
  it('sends absolute time and presentation fields without a ticking remaining value', async () => {
    const nativeModule = installNativeModule();
    const facade = await loadFacade();

    await facade.start(BASE_STATE);

    expect(nativeModule.start).toHaveBeenCalledWith(BASE_STATE);
    const payload = nativeModule.start.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.startedAt).toBe(100_000);
    expect(payload.endsAt).toBe(190_000);
    expect(payload.setIndex).toBe(1);
    expect(payload).not.toHaveProperty('remainingSeconds');
    expect(payload).not.toHaveProperty('restLeft');
    expect(payload).not.toHaveProperty('exerciseId');
    expect(payload).not.toHaveProperty('templateId');
  });

  it('updates with the complete new absolute state after an extension', async () => {
    const nativeModule = installNativeModule();
    const facade = await loadFacade();
    const extended = { ...BASE_STATE, endsAt: BASE_STATE.endsAt + 15_000 };

    await facade.start(BASE_STATE);
    await facade.update(extended);

    expect(nativeModule.update).toHaveBeenLastCalledWith(extended, false);
    expect(nativeModule.update.mock.calls.at(-1)?.[0].endsAt).toBe(205_000);
  });

  it('forwards emphasis only when explicitly requested for a semantic transition', async () => {
    const nativeModule = installNativeModule({
      available: true,
      surface: 'ios-live-activity',
    });
    const facade = await loadFacade();
    const nextSetState: RestActivityState = {
      ...BASE_STATE,
      phase: REST_ACTIVITY_PHASE.NEXT_SET,
    };

    await facade.start(BASE_STATE);
    await facade.update(nextSetState, { alert: true });

    expect(nativeModule.update).toHaveBeenLastCalledWith(nextSetState, true);
  });

  it('rejects inconsistent phase and next-action payloads before native', async () => {
    const nativeModule = installNativeModule();
    const facade = await loadFacade();
    const invalidState = {
      ...BASE_STATE,
      phase: REST_ACTIVITY_PHASE.NEXT_EXERCISE,
    } as unknown as RestActivityState;

    await facade.start(invalidState);

    expect(nativeModule.start).not.toHaveBeenCalled();
    expect(logs.warn).toHaveBeenCalledWith(
      'restLiveActivity',
      'rest_live_native_error',
      expect.objectContaining({ operation: 'start', reason: 'invalid-state' }),
    );
  });

  it('reuses one logical native surface for later rests in the same workout session', async () => {
    const nativeModule = installNativeModule();
    const facade = await loadFacade();
    const nextRest = {
      ...BASE_STATE,
      startedAt: 250_000,
      endsAt: 310_000,
      setIndex: 2,
      nextSetIndex: 3,
    };

    await facade.start(BASE_STATE);
    await facade.end('completed');
    await facade.start(nextRest);

    expect(nativeModule.start).toHaveBeenCalledTimes(1);
    expect(nativeModule.update).toHaveBeenCalledWith(nextRest, false);
    expect(nativeModule.end).toHaveBeenCalledWith(BASE_STATE.sessionId, 'completed');
  });
});

describe('restLiveActivity fail-open behavior', () => {
  it('captures a native start error', async () => {
    const nativeModule = installNativeModule();
    nativeModule.start.mockImplementationOnce(() => {
      throw new Error('native start failed');
    });
    const facade = await loadFacade();

    await expect(facade.start(BASE_STATE)).resolves.toBeUndefined();
    expect(logs.warn).toHaveBeenCalledWith(
      'restLiveActivity',
      'rest_live_native_error',
      expect.objectContaining({ operation: 'start' }),
    );
  });

  it('captures a native update error', async () => {
    const nativeModule = installNativeModule();
    const facade = await loadFacade();
    await facade.start(BASE_STATE);
    nativeModule.update.mockRejectedValueOnce(new Error('native update failed'));

    await expect(
      facade.update({ ...BASE_STATE, endsAt: 205_000 }),
    ).resolves.toBeUndefined();
    expect(logs.warn).toHaveBeenCalledWith(
      'restLiveActivity',
      'rest_live_native_error',
      expect.objectContaining({ operation: 'update' }),
    );
  });

  it('captures a native end error', async () => {
    const nativeModule = installNativeModule();
    const facade = await loadFacade();
    await facade.start(BASE_STATE);
    nativeModule.end.mockRejectedValueOnce(new Error('native end failed'));

    await expect(facade.end('workout_ended')).resolves.toBeUndefined();
    expect(logs.warn).toHaveBeenCalledWith(
      'restLiveActivity',
      'rest_live_native_error',
      expect.objectContaining({ operation: 'end' }),
    );
  });

  it('still dismisses after publication capability is revoked', async () => {
    const nativeModule = installNativeModule();
    const facade = await loadFacade();

    await facade.start(BASE_STATE);
    nativeModule.getCapabilities.mockResolvedValue({
      available: false,
      surface: 'none',
    });
    await facade.end('workout_ended');

    expect(nativeModule.getCapabilities).toHaveBeenCalledTimes(1);
    expect(nativeModule.end).toHaveBeenCalledWith(
      BASE_STATE.sessionId,
      'workout_ended',
    );
  });

  it('preserves call order for rapid start, update and end requests', async () => {
    const nativeModule = installNativeModule();
    const order: string[] = [];
    nativeModule.start.mockImplementation(async () => { order.push('start'); });
    nativeModule.update.mockImplementation(async () => { order.push('update'); });
    nativeModule.end.mockImplementation(async () => { order.push('end'); });
    const facade = await loadFacade();

    await Promise.all([
      facade.start(BASE_STATE),
      facade.update({ ...BASE_STATE, endsAt: 205_000 }),
      facade.end('cancelled'),
    ]);

    expect(order).toEqual(['start', 'update', 'end']);
  });

  it('serializes a rapid start then cancel so the final native state is ended', async () => {
    const nativeModule = installNativeModule();
    const order: string[] = [];
    nativeModule.start.mockImplementation(async () => { order.push('start'); });
    nativeModule.end.mockImplementation(async () => { order.push('end'); });
    const facade = await loadFacade();

    await Promise.all([facade.start(BASE_STATE), facade.end('cancelled')]);

    expect(order).toEqual(['start', 'end']);
  });

  it('queues orphan cleanup after pending start/update and leaves no logical surface', async () => {
    const nativeModule = installNativeModule();
    const order: string[] = [];
    nativeModule.start.mockImplementation(async () => { order.push('start'); });
    nativeModule.update.mockImplementation(async () => { order.push('update'); });
    nativeModule.cleanup?.mockImplementation(async () => { order.push('cleanup'); });
    const facade = await loadFacade();

    await Promise.all([
      facade.start(BASE_STATE),
      facade.update({ ...BASE_STATE, endsAt: 205_000 }),
      facade.cleanup(),
    ]);
    await facade.start({ ...BASE_STATE, startedAt: 300_000, endsAt: 390_000 });

    expect(order).toEqual(['start', 'update', 'cleanup', 'start']);
    expect(nativeModule.start).toHaveBeenCalledTimes(2);
  });

  it('deduplicates repeated cleanup and tolerates a pre-Phase-7 native binary', async () => {
    const nativeModule = installNativeModule();
    const facade = await loadFacade();

    await facade.cleanup();
    await facade.cleanup();
    expect(nativeModule.cleanup).toHaveBeenCalledTimes(1);

    vi.resetModules();
    delete nativeModule.cleanup;
    const legacyFacade = await loadFacade();
    await expect(legacyFacade.cleanup()).resolves.toBeUndefined();
  });

  it('does not send workout_ended repeatedly after the logical session is closed', async () => {
    const nativeModule = installNativeModule();
    const facade = await loadFacade();

    await facade.start(BASE_STATE);
    await facade.end('workout_ended');
    await facade.end('workout_ended');

    expect(nativeModule.end).toHaveBeenCalledTimes(1);
    expect(nativeModule.end).toHaveBeenCalledWith(
      BASE_STATE.sessionId,
      'workout_ended',
    );
  });
});
