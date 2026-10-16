import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { guidedWorkoutShowcaseSlides, type GuidedWorkoutSlideId } from '../data/guidedWorkoutShowcase';
import { configureSilentDemoVideo } from '../lib/silentDemoVideo';

const METHODOLOGY_VIDEO_SOURCE = require('../../assets/videos/methodology-workout.mp4');

/**
 * Singleton-per-video registry backing the onboarding funnel's background
 * videos (Methodology, Guided Workout). `createVideoPlayer` (unlike the
 * auto-releasing `useVideoPlayer` hook) isn't tied to any component's mount,
 * so a player created here keeps opening/preparing its local asset across
 * several more funnel steps instead of starting from zero only once the
 * interstitial itself mounts.
 */
let methodologyPlayer: VideoPlayer | null = null;
const guidedWorkoutPlayers: Partial<Record<GuidedWorkoutSlideId, VideoPlayer>> = {};

function createLoopingMutedPlayer(source: number): VideoPlayer {
  const player = createVideoPlayer(source);
  configureSilentDemoVideo(player);
  return player;
}

export function getMethodologyVideoPlayer(): VideoPlayer {
  if (!methodologyPlayer) {
    methodologyPlayer = createLoopingMutedPlayer(METHODOLOGY_VIDEO_SOURCE);
  }
  return methodologyPlayer;
}

/**
 * The Guided Workout interstitial is a carousel of three short clips
 * (`video-01/02/03.mp4`), each with its own singleton player so the
 * carousel can pause the inactive two while the active one plays.
 */
export function getGuidedWorkoutVideoPlayers(): Record<GuidedWorkoutSlideId, VideoPlayer> {
  for (const slide of guidedWorkoutShowcaseSlides) {
    if (!guidedWorkoutPlayers[slide.id]) {
      guidedWorkoutPlayers[slide.id] = createLoopingMutedPlayer(slide.source);
    }
  }
  return guidedWorkoutPlayers as Record<GuidedWorkoutSlideId, VideoPlayer>;
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
 * Warms up the Guided Workout singletons two steps before the user can reach
 * that interstitial (`duration` → `place` → `interstitial_guidedWorkout`).
 * Idempotent: safe to call on every render of the triggering step.
 */
export function preloadGuidedWorkoutVideo(): void {
  getGuidedWorkoutVideoPlayers();
}

/**
 * Releases the Methodology player. Called once the funnel has moved past it
 * for good (reaching the Guided Workout interstitial, which is always after
 * Methodology in every funnel sequence) so the two decoders aren't both kept
 * warm indefinitely — not on the Methodology screen's own unmount, since a
 * dev jump or back-navigation revisit should still find it warm.
 */
export function releaseMethodologyVideoPlayer(): void {
  methodologyPlayer?.release();
  methodologyPlayer = null;
}

/**
 * Releases the three Guided Workout players. Call when the whole funnel
 * unmounts (user leaves onboarding) — not on the interstitial screen's own
 * unmount, which only pauses them so revisiting (dev jump, or going back
 * then forward again) doesn't pay the decoder-init cost twice.
 */
export function releaseGuidedWorkoutVideoPlayer(): void {
  for (const slide of guidedWorkoutShowcaseSlides) {
    guidedWorkoutPlayers[slide.id]?.release();
    delete guidedWorkoutPlayers[slide.id];
  }
}
