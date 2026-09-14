import { describe, expect, it, vi } from 'vitest';

import { createWorkoutShareController, type WorkoutShareDependencies } from '../share';

vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(), shareAsync: vi.fn() }));
vi.mock('../../../modules/ajfit-instagram-stories', () => ({
  getAJFitInstagramStoriesNativeModule: () => null,
}));
vi.mock('../files', () => ({ discardWorkoutShareFile: vi.fn() }));

const availableCapabilities = {
  instagramInstalled: true,
  schemeAvailable: true,
  sourceApplicationConfigured: true,
};

function dependencies(overrides: Partial<WorkoutShareDependencies> = {}): WorkoutShareDependencies {
  return {
    isGenericAvailable: vi.fn(async () => true),
    shareGeneric: vi.fn(async () => undefined),
    getInstagramCapabilities: vi.fn(async () => availableCapabilities),
    shareInstagram: vi.fn(async () => undefined),
    cleanup: vi.fn(),
    delay: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('workout share handoff', () => {
  it('reports an OS handoff, not Story acceptance, after opening Instagram', async () => {
    const deps = dependencies();
    const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagram');
    expect(result).toEqual({ status: 'handedOff', destination: 'instagram' });
    expect(deps.shareInstagram).toHaveBeenCalledOnce();
    expect(deps.shareGeneric).not.toHaveBeenCalled();
  });

  it('is single-flight across rapid destination taps', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = dependencies({ shareGeneric: vi.fn(() => gate) });
    const controller = createWorkoutShareController(deps);
    const first = controller.share('file:///cache/workout-share/export/a.jpg', 'generic');
    const second = controller.share('file:///cache/workout-share/export/b.jpg', 'instagram');
    expect(second).toBe(first);
    release();
    await first;
    expect(deps.shareGeneric).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic sheet when Instagram is unavailable', async () => {
    const deps = dependencies({
      getInstagramCapabilities: vi.fn(async () => ({
        ...availableCapabilities,
        instagramInstalled: false,
        schemeAvailable: false,
      })),
    });
    const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagram');
    expect(result).toEqual({ status: 'fallback', destination: 'generic' });
    expect(deps.shareInstagram).not.toHaveBeenCalled();
    expect(deps.shareGeneric).toHaveBeenCalledOnce();
  });

  it('falls back without opening Instagram when source_application is unconfigured', async () => {
    const deps = dependencies({
      getInstagramCapabilities: vi.fn(async () => ({
        ...availableCapabilities,
        sourceApplicationConfigured: false,
      })),
    });
    const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagram');
    expect(result).toEqual({ status: 'fallback', destination: 'generic' });
    expect(deps.shareInstagram).not.toHaveBeenCalled();
    expect(deps.shareGeneric).toHaveBeenCalledOnce();
  });

  it('falls back when the direct Instagram handoff fails', async () => {
    const deps = dependencies({ shareInstagram: vi.fn(async () => { throw new Error('native failure'); }) });
    const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagram');
    expect(result.status).toBe('fallback');
    expect(deps.shareGeneric).toHaveBeenCalledOnce();
  });

  it('turns a missing native JPEG into a controlled generic fallback', async () => {
    const deps = dependencies({
      shareInstagram: vi.fn(async () => { throw new Error('JPEG file does not exist'); }),
    });
    const result = await createWorkoutShareController(deps).share('file:///missing.jpg', 'instagram');
    expect(result).toEqual({ status: 'fallback', destination: 'generic' });
    expect(deps.shareGeneric).toHaveBeenCalledOnce();
  });

  it('cleans the temporary export after success and after an error', async () => {
    const success = dependencies();
    await createWorkoutShareController(success).share('file:///success.jpg', 'generic');
    expect(success.cleanup).toHaveBeenCalledWith('file:///success.jpg');

    const failure = dependencies({ shareGeneric: vi.fn(async () => { throw new Error('share failed'); }) });
    await expect(createWorkoutShareController(failure).share('file:///failure.jpg', 'generic')).rejects.toThrow();
    expect(failure.cleanup).toHaveBeenCalledWith('file:///failure.jpg');
  });
});
