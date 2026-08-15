import { describe, expect, it } from 'vitest';
import {
  PERSISTENT_TAB_IDS,
  computeShouldMount,
  isPersistentTab,
} from '../tabLifecycle';

describe('tab persistence policy', () => {
  it('marks home, progress and profile as persistent', () => {
    expect(isPersistentTab('home')).toBe(true);
    expect(isPersistentTab('progress')).toBe(true);
    expect(isPersistentTab('profile')).toBe(true);
  });

  it('excludes workout — see docs/23_navegacao_e_lifecycle.md "Exceções"', () => {
    expect(isPersistentTab('workout')).toBe(false);
    expect(PERSISTENT_TAB_IDS).not.toContain('workout');
  });
});

describe('computeShouldMount (PersistentScreen mount-once decision)', () => {
  it('stays false until the screen is first active or prewarmed', () => {
    expect(computeShouldMount(false, false, false)).toBe(false);
  });

  it('becomes true the first time the screen is active', () => {
    expect(computeShouldMount(false, true, false)).toBe(true);
  });

  it('becomes true the first time the screen is prewarmed, with no activation at all', () => {
    expect(computeShouldMount(false, false, true)).toBe(true);
  });

  it('never becomes false again once it was ever mounted', () => {
    expect(computeShouldMount(true, false, false)).toBe(true);
  });

  it('stays true across repeated activations (idempotent)', () => {
    expect(computeShouldMount(true, true, false)).toBe(true);
  });

  it('proves the full keep-alive sequence: Home → Progress → Home → Progress mounts Progress once', () => {
    // Simulates PersistentScreen's state for the Progress tab across:
    // start on home (progress inactive) → visit progress → back to home →
    // visit progress again. `mounted` flips to true exactly once and
    // never resets, which is the guarantee "Progress mounts a single time"
    // depends on. Progress is never prewarmed in this scenario.
    let mounted = computeShouldMount(false, false, false); // app starts on 'home'
    expect(mounted).toBe(false); // Progress not mounted yet

    mounted = computeShouldMount(mounted, true, false); // NAVIGATION_REQUEST home -> progress
    expect(mounted).toBe(true); // first (and only) mount

    mounted = computeShouldMount(mounted, false, false); // NAVIGATION_REQUEST progress -> home
    expect(mounted).toBe(true); // stays mounted, just inactive

    mounted = computeShouldMount(mounted, true, false); // NAVIGATION_REQUEST home -> progress (2nd visit)
    expect(mounted).toBe(true); // no re-mount — same `true`, no false→true transition
  });

  it('proves the prewarm sequence: Settings mounts before the user ever taps it, first tap only activates', () => {
    // Simulates PersistentScreen's state for Settings across: app starts
    // (not active, not yet prewarmed) → background prewarm fires (still not
    // active) → user taps Settings (active) → user leaves → user re-enters.
    let mounted = computeShouldMount(false, false, false); // app starts, Settings untouched
    expect(mounted).toBe(false); // SETTINGS_MOUNT has not happened

    mounted = computeShouldMount(mounted, false, true); // SETTINGS_PREWARM_START fires, active still false
    expect(mounted).toBe(true); // SETTINGS_MOUNT happens here — off the user's critical path

    mounted = computeShouldMount(mounted, true, false); // user taps Settings: SETTINGS_NAVIGATION_REQUEST
    expect(mounted).toBe(true); // stays true — NOT a new mount, only `active` flips

    mounted = computeShouldMount(mounted, false, false); // user leaves Settings
    expect(mounted).toBe(true); // still mounted, just inactive — no unmount

    mounted = computeShouldMount(mounted, true, false); // user re-enters Settings
    expect(mounted).toBe(true); // no new mount on 2nd (or any later) entry either
  });

  it('is idempotent if a screen is prewarmed after it was already activated by the user', () => {
    // The race condition explicitly called out in the investigation: user
    // navigates to a screen before its scheduled prewarm task fires. The
    // late-arriving prewarm=true must not cause a second mount or any
    // state change — mounted is already true via the `active` path.
    let mounted = computeShouldMount(false, true, false); // user opens Settings before prewarm ran
    expect(mounted).toBe(true);

    mounted = computeShouldMount(mounted, true, true); // the scheduled prewarm callback fires late
    expect(mounted).toBe(true); // no-op — already mounted, no duplicate mount/effects
  });
});
