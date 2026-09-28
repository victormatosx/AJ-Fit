/**
 * One-way latch: true once the cold-start `WordmarkSplash` (App.tsx) has
 * already played and finished once in this JS process. Module-scoped, not
 * React state — it must survive `AppContent` re-renders and be readable
 * synchronously (it seeds `AppContent`'s initial `booting` state) with no
 * propagation lag.
 *
 * While `false` (still inside the very first cold start): `AppContent`
 * mounts `WordmarkSplash` as an overlay on top of the whole app tree.
 *
 * Once `true` (set from `WordmarkSplash`'s `onDone`): `AppContent` never
 * mounts it again, in this process, no matter what triggers a render again
 * (background/foreground, internal navigation, a later logout/login) — the
 * splash is strictly a cold-start, once-per-process surface.
 */
let completed = false;

export function hasCompletedInitialBoot(): boolean {
  return completed;
}

export function markInitialBootCompleted(): void {
  completed = true;
}

/** Test-only: resets the module-level latch between test cases. */
export function resetInitialBootReadinessForTests(): void {
  completed = false;
}
