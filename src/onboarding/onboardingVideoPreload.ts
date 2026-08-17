import { createVideoPlayer, type VideoPlayer } from 'expo-video';

// eslint-disable-next-line @typescript-eslint/no-var-requires -- static asset require, path fixed at build time
const METHODOLOGY_VIDEO_SOURCE = require('../../assets/videos/methodology-workout.mp4');
// eslint-disable-next-line @typescript-eslint/no-var-requires -- static asset require, path fixed at build time
const GUIDED_WORKOUT_VIDEO_SOURCE = require('../../assets/videos/guided-workout.mp4');

/**
 * Singleton-per-video registry backing the onboarding funnel's background
 * videos (Methodology, Guided Workout). `createVideoPlayer` (unlike the
 * auto-releasing `useVideoPlayer` hook) isn't tied to any component's mount,
 * so a player created here keeps opening/preparing its local asset across
 * several more funnel steps instead of starting from zero only once the
 * interstitial itself mounts.
 *
 * Two small named entries rather than a generic map: only two videos exist,
 * both wired into `OnboardingFunnelScreen` explicitly, so a registry
 * abstraction would add indirection without removing any real duplication.
 */
const players: { methodology: VideoPlayer | null; guidedWorkout: VideoPlayer | null } = {
  methodology: null,
  guidedWorkout: null,
};

function getOrCreatePlayer(key: keyof typeof players, source: number): VideoPlayer {
  let player = players[key];
  if (!player) {
    player = createVideoPlayer(source);
    player.loop = true;
    player.muted = true;
    players[key] = player;
  }
  return player;
}

export function getMethodologyVideoPlayer(): VideoPlayer {
  return getOrCreatePlayer('methodology', METHODOLOGY_VIDEO_SOURCE);
}

export function getGuidedWorkoutVideoPlayer(): VideoPlayer {
  return getOrCreatePlayer('guidedWorkout', GUIDED_WORKOUT_VIDEO_SOURCE);
}

/**
 * Warms up the Methodology singleton a couple of steps before the user can
 * reach that interstitial, so the native decoder has already opened the
 * (local, bundled — no network) asset by the time `VideoView` mounts.
 * Idempotent: safe to call on every render of the triggering step.
 */
export function preloadMethodologyVideo(): void {
  getMethodologyVideoPlayer();
}

/**
 * Warms up the Guided Workout singleton two steps before the user can reach
 * that interstitial (`duration` → `place` → `interstitial_guidedWorkout`).
 * Idempotent: safe to call on every render of the triggering step.
 */
export function preloadGuidedWorkoutVideo(): void {
  getGuidedWorkoutVideoPlayer();
}

/**
 * Releases the Methodology player. Called once the funnel has moved past it
 * for good (reaching the Guided Workout interstitial, which is always after
 * Methodology in every funnel sequence) so the two decoders aren't both kept
 * warm indefinitely — not on the Methodology screen's own unmount, since a
 * dev jump or back-navigation revisit should still find it warm.
 */
export function releaseMethodologyVideoPlayer(): void {
  players.methodology?.release();
  players.methodology = null;
}

/**
 * Releases the Guided Workout player. Call when the whole funnel unmounts
 * (user leaves onboarding) — not on the interstitial screen's own unmount,
 * which only pauses it so revisiting (dev jump, or going back then forward
 * again) doesn't pay the decoder-init cost twice.
 */
export function releaseGuidedWorkoutVideoPlayer(): void {
  players.guidedWorkout?.release();
  players.guidedWorkout = null;
}
