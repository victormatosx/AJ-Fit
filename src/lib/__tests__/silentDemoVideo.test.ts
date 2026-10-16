import { readFileSync } from 'node:fs';
import type { VideoPlayer } from 'expo-video';
import type { AppStateStatus } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { configureSilentDemoVideo, observeSilentDemoAppState } from '../silentDemoVideo';

function createPlayer() {
  return {
    audioMixingMode: 'doNotMix',
    muted: false,
    showNowPlayingNotification: true,
    staysActiveInBackground: true,
    allowsExternalPlayback: true,
    loop: false,
    volume: 1,
    play: vi.fn(),
    pause: vi.fn(),
  } satisfies Partial<VideoPlayer>;
}

function createAppState(currentState: AppStateStatus | null = 'active') {
  const listeners = new Set<(state: AppStateStatus) => void>();
  // Keep even removed callbacks to simulate a queued event after cleanup.
  const queued: ((state: AppStateStatus) => void)[] = [];
  return {
    currentState,
    addEventListener: vi.fn((_event: 'change', listener: (state: AppStateStatus) => void) => {
      listeners.add(listener);
      queued.push(listener);
      return { remove: () => listeners.delete(listener) };
    }),
    emit(state: AppStateStatus) {
      this.currentState = state;
      listeners.forEach((listener) => listener(state));
    },
    queued,
    listeners,
  };
}

describe('silent visual demo policy', () => {
  it('sets a nonexclusive, silent policy before autoplay, independent of audio track metadata', () => {
    const target = createPlayer();
    const assignments: string[] = [];
    const player = new Proxy(target, {
      set(object, property, value) {
        assignments.push(String(property));
        return Reflect.set(object, property, value);
      },
    });
    // Policy deliberately does not depend on metadata or track discovery.
    configureSilentDemoVideo(player as unknown as VideoPlayer);
    expect(assignments[0]).toBe('audioMixingMode');
    expect(target).toMatchObject({
      audioMixingMode: 'mixWithOthers', muted: true, loop: true,
      showNowPlayingNotification: false, staysActiveInBackground: false,
      allowsExternalPlayback: false, volume: 1,
    });
    expect(target.play).not.toHaveBeenCalled();
    expect(assignments).not.toContain('volume');
    expect(assignments).not.toContain('audioTrack');
  });

  it('applies the policy to every new exercise/orientation/fallback player without changing another player', () => {
    const audiblePlayer = createPlayer();
    const firstDemo = createPlayer();
    const replacementDemo = createPlayer();
    for (const player of [firstDemo, replacementDemo]) {
      configureSilentDemoVideo(player as unknown as VideoPlayer);
      expect(player.audioMixingMode).toBe('mixWithOthers');
      expect(player.muted).toBe(true);
    }
    expect(audiblePlayer.audioMixingMode).toBe('doNotMix');
    expect(audiblePlayer.muted).toBe(false);
  });

  it('wires the policy into both shared silent player factories, before exercise play', () => {
    const exercise = readFileSync(new URL('../../components/fitness/ExerciseGif.tsx', import.meta.url), 'utf8');
    const onboarding = readFileSync(new URL('../../onboarding/onboardingVideoPreload.ts', import.meta.url), 'utf8');
    expect(exercise.indexOf('configureSilentDemoVideo(p)')).toBeLessThan(exercise.indexOf('p.play()'));
    expect(exercise).toContain('observeSilentDemoAppState(player, AppState)');
    expect(onboarding).toContain('configureSilentDemoVideo(player)');
  });
});

describe('exercise demo lifecycle', () => {
  it('autoplays, pauses while inactive/backgrounded and resumes on foreground', () => {
    const player = createPlayer();
    const appState = createAppState();
    const dispose = observeSilentDemoAppState(player, appState);
    expect(player.play).toHaveBeenCalledTimes(1);
    appState.emit('inactive');
    appState.emit('background');
    expect(player.pause).toHaveBeenCalledTimes(2);
    appState.emit('active');
    expect(player.play).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('does not autoplay a new video while the app is already backgrounded', () => {
    const player = createPlayer();
    const appState = createAppState('background');
    const dispose = observeSilentDemoAppState(player, appState);
    expect(player.play).not.toHaveBeenCalled();
    expect(player.pause).toHaveBeenCalledTimes(1);
    appState.emit('active');
    expect(player.play).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('preserves autoplay when the initial RN app state is not available yet', () => {
    const player = createPlayer();
    const dispose = observeSilentDemoAppState(player, createAppState(null));
    expect(player.play).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('switching video removes the old listener and never calls a released player, even for queued events', () => {
    const oldPlayer = createPlayer();
    const newPlayer = createPlayer();
    const appState = createAppState();
    const disposeOld = observeSilentDemoAppState(oldPlayer, appState);
    disposeOld();
    oldPlayer.play.mockImplementation(() => { throw new Error('released native player'); });
    oldPlayer.pause.mockImplementation(() => { throw new Error('released native player'); });
    const disposeNew = observeSilentDemoAppState(newPlayer, appState);
    expect(() => appState.queued[0]('active')).not.toThrow();
    appState.emit('background');
    appState.emit('active');
    expect(oldPlayer.play).toHaveBeenCalledTimes(1);
    expect(oldPlayer.pause).not.toHaveBeenCalled();
    expect(newPlayer.play).toHaveBeenCalledTimes(2);
    expect(newPlayer.pause).toHaveBeenCalledTimes(1);
    disposeNew();
    expect(appState.listeners.size).toBe(0);
  });
});
