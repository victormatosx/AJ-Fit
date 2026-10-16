import type { VideoPlayer } from 'expo-video';
import type { AppStateStatus } from 'react-native';

/** Only for visual demonstrations, never for media intended to output audio. */
export function configureSilentDemoVideo(player: VideoPlayer): void {
  // Set this BEFORE mute/play: the installed iOS player defaults to doNotMix,
  // which activates an exclusive audio session even for a muted video.
  // Android's mixWithOthers path explicitly skips requesting audio focus.
  player.audioMixingMode = 'mixWithOthers';
  player.muted = true;
  player.showNowPlayingNotification = false;
  player.staysActiveInBackground = false;
  player.allowsExternalPlayback = false;
  player.loop = true;
}

type DemoPlayback = Pick<VideoPlayer, 'play' | 'pause'>;
type DemoAppState = {
  readonly currentState: AppStateStatus | null;
  addEventListener(
    event: 'change',
    listener: (state: AppStateStatus) => void,
  ): { remove(): void };
};

/** Resume autoplay after the native player pauses on backgrounding. */
export function observeSilentDemoAppState(player: DemoPlayback, appState: DemoAppState): () => void {
  let disposed = false;
  const sync = (state: AppStateStatus | null) => {
    if (disposed) return;
    // null can occur before RN has delivered the initial state.
    if (state === 'active' || state === null) player.play();
    else player.pause();
  };
  const subscription = appState.addEventListener('change', sync);
  sync(appState.currentState);
  return () => {
    disposed = true;
    subscription.remove();
    // useVideoPlayer owns release. Never call pause on an old native object
    // here: it may already have been released when the exercise changes.
  };
}
