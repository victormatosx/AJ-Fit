import { createVideoPlayer, type VideoPlayer } from 'expo-video';

// eslint-disable-next-line @typescript-eslint/no-var-requires -- static asset require, path fixed at build time
const METHODOLOGY_VIDEO_SOURCE = require('../../assets/videos/methodology-workout.mp4');

let player: VideoPlayer | null = null;

/**
 * Singleton player backing the Methodology interstitial's background video.
 *
 * `createVideoPlayer` (unlike the auto-releasing `useVideoPlayer` hook) isn't
 * tied to any component's mount, so a player created here keeps opening/
 * preparing the local asset across several more funnel steps instead of
 * starting from zero only once the interstitial itself mounts. See
 * `preloadMethodologyVideo` for when this actually gets called, and
 * `releaseMethodologyVideoPlayer` for when it's torn down.
 */
export function getMethodologyVideoPlayer(): VideoPlayer {
  if (!player) {
    player = createVideoPlayer(METHODOLOGY_VIDEO_SOURCE);
    player.loop = true;
    player.muted = true;
  }
  return player;
}

/**
 * Warms up the singleton a couple of steps before the user can reach the
 * Methodology interstitial, so the native decoder has already opened the
 * (local, bundled — no network) asset by the time `VideoView` mounts.
 * Idempotent: safe to call on every render of the triggering step.
 */
export function preloadMethodologyVideo(): void {
  getMethodologyVideoPlayer();
}

/**
 * Releases the singleton. Call this when the whole funnel unmounts (user
 * leaves onboarding), not when the interstitial screen itself unmounts —
 * the screen only pauses on unmount, so revisiting it (dev jump, or if the
 * funnel ever allows going back) doesn't pay the decoder-init cost twice.
 */
export function releaseMethodologyVideoPlayer(): void {
  player?.release();
  player = null;
}
