import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkoutShareController,
  GENERIC_SHARE_HANDOFF_TIMEOUT_MS,
  INSTAGRAM_HANDOFF_TIMEOUT_MS,
  type WorkoutShareDependencies,
} from '../share';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
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
    shareInstagramStories: vi.fn(async () => undefined),
    isInstagramFeedNativeSupported: vi.fn(() => false),
    isInstagramAppAvailable: vi.fn(async () => false),
    shareInstagramFeed: vi.fn(async () => undefined),
    cleanup: vi.fn(),
    delay: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('workout share handoff', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('instagram Stories (direct native handoff, unchanged)', () => {
    it('reports an OS handoff, not Story acceptance, after opening Instagram Stories', async () => {
      const deps = dependencies();
      const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagramStories');
      expect(result).toEqual({ status: 'handedOff', destination: 'instagramStories' });
      expect(deps.shareInstagramStories).toHaveBeenCalledOnce();
      expect(deps.shareGeneric).not.toHaveBeenCalled();
    });

    it('falls back to the generic sheet when Instagram Stories is unavailable', async () => {
      const deps = dependencies({
        getInstagramCapabilities: vi.fn(async () => ({
          ...availableCapabilities,
          instagramInstalled: false,
          schemeAvailable: false,
        })),
      });
      const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagramStories');
      expect(result).toEqual({ status: 'fallback', destination: 'generic' });
      expect(deps.shareInstagramStories).not.toHaveBeenCalled();
      expect(deps.shareGeneric).toHaveBeenCalledOnce();
    });

    it('falls back without opening Instagram Stories when source_application is unconfigured', async () => {
      const deps = dependencies({
        getInstagramCapabilities: vi.fn(async () => ({
          ...availableCapabilities,
          sourceApplicationConfigured: false,
        })),
      });
      const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagramStories');
      expect(result).toEqual({ status: 'fallback', destination: 'generic' });
      expect(deps.shareInstagramStories).not.toHaveBeenCalled();
      expect(deps.shareGeneric).toHaveBeenCalledOnce();
    });

    it('falls back when the direct Instagram Stories handoff fails', async () => {
      const deps = dependencies({ shareInstagramStories: vi.fn(async () => { throw new Error('native failure'); }) });
      const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagramStories');
      expect(result.status).toBe('fallback');
      expect(deps.shareGeneric).toHaveBeenCalledOnce();
    });

    it('recovers into the generic sheet instead of hanging forever when the native handoff never settles', async () => {
      vi.useFakeTimers();
      try {
        const deps = dependencies({ shareInstagramStories: vi.fn(() => new Promise<void>(() => {})) });
        const pending = createWorkoutShareController(deps).share('file:///a.jpg', 'instagramStories');
        await vi.advanceTimersByTimeAsync(INSTAGRAM_HANDOFF_TIMEOUT_MS);
        const result = await pending;
        expect(result).toEqual({ status: 'fallback', destination: 'generic' });
        expect(deps.shareGeneric).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it('turns a missing native JPEG into a controlled generic fallback', async () => {
      const deps = dependencies({
        shareInstagramStories: vi.fn(async () => { throw new Error('JPEG file does not exist'); }),
      });
      const result = await createWorkoutShareController(deps).share('file:///missing.jpg', 'instagramStories');
      expect(result).toEqual({ status: 'fallback', destination: 'generic' });
      expect(deps.shareGeneric).toHaveBeenCalledOnce();
    });
  });

  describe('instagram Feed (direct native handoff, iOS-only)', () => {
    it('hands off through the native module when Instagram is installed', async () => {
      const deps = dependencies({
        isInstagramFeedNativeSupported: vi.fn(() => true),
        isInstagramAppAvailable: vi.fn(async () => true),
      });
      const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagram');
      expect(result).toEqual({ status: 'handedOff', destination: 'instagram' });
      expect(deps.shareInstagramFeed).toHaveBeenCalledWith('file:///a.jpg');
      expect(deps.shareGeneric).not.toHaveBeenCalled();
    });

    it('falls back to the generic sheet when Instagram is not installed', async () => {
      const deps = dependencies({
        isInstagramFeedNativeSupported: vi.fn(() => true),
        isInstagramAppAvailable: vi.fn(async () => false),
      });
      const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagram');
      expect(result).toEqual({ status: 'fallback', destination: 'generic' });
      expect(deps.shareInstagramFeed).not.toHaveBeenCalled();
      expect(deps.shareGeneric).toHaveBeenCalledOnce();
    });

    it('falls back to the generic sheet when the native handoff throws (e.g. permission denied, asset creation failed)', async () => {
      const deps = dependencies({
        isInstagramFeedNativeSupported: vi.fn(() => true),
        isInstagramAppAvailable: vi.fn(async () => true),
        shareInstagramFeed: vi.fn(async () => { throw new Error('Photos add-only permission was not granted'); }),
      });
      const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagram');
      expect(result).toEqual({ status: 'fallback', destination: 'generic' });
      expect(deps.shareGeneric).toHaveBeenCalledOnce();
    });

    it('recovers into the generic sheet instead of hanging forever when the native handoff never settles', async () => {
      vi.useFakeTimers();
      try {
        const deps = dependencies({
          isInstagramFeedNativeSupported: vi.fn(() => true),
          isInstagramAppAvailable: vi.fn(async () => true),
          shareInstagramFeed: vi.fn(() => new Promise<void>(() => {})),
        });
        const pending = createWorkoutShareController(deps).share('file:///a.jpg', 'instagram');
        await vi.advanceTimersByTimeAsync(INSTAGRAM_HANDOFF_TIMEOUT_MS);
        const result = await pending;
        expect(result).toEqual({ status: 'fallback', destination: 'generic' });
        expect(deps.shareGeneric).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it('falls straight to the generic sheet on Android (no native feed support), without touching the native module', async () => {
      const deps = dependencies({ isInstagramFeedNativeSupported: vi.fn(() => false) });
      const result = await createWorkoutShareController(deps).share('file:///a.jpg', 'instagram');
      expect(result).toEqual({ status: 'fallback', destination: 'generic' });
      expect(deps.isInstagramAppAvailable).not.toHaveBeenCalled();
      expect(deps.shareInstagramFeed).not.toHaveBeenCalled();
      expect(deps.shareGeneric).toHaveBeenCalledOnce();
    });
  });

  describe.each(['whatsapp', 'facebook', 'tiktok', 'generic'] as const)(
    '%s (always the generic OS share sheet, no per-app branch)',
    (destination) => {
      it('opens the generic sheet directly, with no direct-app handoff attempt', async () => {
        const deps = dependencies();
        const result = await createWorkoutShareController(deps).share('file:///a.jpg', destination);
        expect(result).toEqual({ status: 'shared', destination: 'generic' });
        expect(deps.shareGeneric).toHaveBeenCalledWith('file:///a.jpg');
      });

      it('reports unavailable, not stuck, when the generic sheet itself is unavailable', async () => {
        const deps = dependencies({ isGenericAvailable: vi.fn(async () => false) });
        const result = await createWorkoutShareController(deps).share('file:///a.jpg', destination);
        expect(result).toEqual({ status: 'unavailable' });
        expect(deps.shareGeneric).not.toHaveBeenCalled();
      });

      it('propagates a real, immediate failure from the native sheet as a rejection', async () => {
        const deps = dependencies({
          shareGeneric: vi.fn(async () => { throw new Error('no presenter available'); }),
        });
        const controller = createWorkoutShareController(deps);
        await expect(controller.share('file:///a.jpg', destination)).rejects.toThrow('no presenter available');
        expect(controller.isSharing()).toBe(false);
      });

      it('never leaves the composer stuck in loading when the native sheet promise never settles', async () => {
        // The scenario this guards against: iOS/Android silently drops the
        // present/launch call and its completion callback never fires.
        vi.useFakeTimers();
        try {
          const deps = dependencies({ shareGeneric: vi.fn(() => new Promise<void>(() => {})) });
          const controller = createWorkoutShareController(deps);
          const pending = controller.share('file:///a.jpg', destination);
          await vi.advanceTimersByTimeAsync(GENERIC_SHARE_HANDOFF_TIMEOUT_MS);
          const result = await pending;
          expect(result).toEqual({ status: 'shared', destination: 'generic' });
          expect(controller.isSharing()).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      });

      it('defers cleanup instead of deleting the file mid-flight when the handoff times out', async () => {
        vi.useFakeTimers();
        try {
          const deps = dependencies({ shareGeneric: vi.fn(() => new Promise<void>(() => {})) });
          const controller = createWorkoutShareController(deps);
          const pending = controller.share('file:///a.jpg', destination);
          await vi.advanceTimersByTimeAsync(GENERIC_SHARE_HANDOFF_TIMEOUT_MS);
          await pending;
          // Cleanup is leased via the delayed grace window, not deleted
          // synchronously in run()'s finally — the sheet might still be open.
          expect(deps.cleanup).toHaveBeenCalledWith('file:///a.jpg');
        } finally {
          vi.useRealTimers();
        }
      });

      it('cleans the temporary export after a normal success', async () => {
        const deps = dependencies();
        await createWorkoutShareController(deps).share('file:///a.jpg', destination);
        expect(deps.cleanup).toHaveBeenCalledWith('file:///a.jpg');
      });
    },
  );

  it('is single-flight across rapid destination taps', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = dependencies({ shareGeneric: vi.fn(() => gate) });
    const controller = createWorkoutShareController(deps);
    const first = controller.share('file:///cache/workout-share/export/a.jpg', 'generic');
    const second = controller.share('file:///cache/workout-share/export/b.jpg', 'whatsapp');
    expect(second).toBe(first);
    release();
    await first;
    expect(deps.shareGeneric).toHaveBeenCalledTimes(1);
  });
});
