/**
 * Whether the Photo Vault screen must render the locked (blurred) tree.
 *
 * `unlocked` is the ONLY security-relevant input: whenever it is false, the
 * real gallery must never mount, no matter what `showLocked` says. That is
 * why this is `!unlocked || showLocked` and not just `showLocked` — the
 * latter is React state written inside a `useEffect`, which runs one commit
 * after a render, so gating on it alone would let a single render through
 * with the real gallery mounted the instant `unlocked` turns false (for
 * example, the app backgrounding while unlocked).
 *
 * `showLocked` only ever EXTENDS the locked view a little further after a
 * real unlock, so `PhotoVaultLockedState`'s success animation has time to
 * finish before the real gallery is revealed. It can never take the locked
 * view down on its own.
 */
export function shouldShowPhotoVaultLocked(
  unlocked: boolean,
  showLocked: boolean,
): boolean {
  return !unlocked || showLocked;
}
