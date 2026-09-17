import { describe, expect, it } from 'vitest';

import { shouldShowPhotoVaultLocked } from '../photoVaultLockedVisibility';

/**
 * The security invariant restated as a truth table: whenever the vault is
 * NOT unlocked, the locked view must show, full stop — `showLocked` can only
 * ever keep it up for LONGER after a real unlock, never take it down early.
 */
describe('shouldShowPhotoVaultLocked', () => {
  it('unlocked=false, showLocked=false -> locked', () => {
    expect(shouldShowPhotoVaultLocked(false, false)).toBe(true);
  });

  it('unlocked=false, showLocked=true -> locked', () => {
    expect(shouldShowPhotoVaultLocked(false, true)).toBe(true);
  });

  it('unlocked=true, showLocked=true -> locked (mid reveal animation)', () => {
    expect(shouldShowPhotoVaultLocked(true, true)).toBe(true);
  });

  it('unlocked=true, showLocked=false -> real gallery', () => {
    expect(shouldShowPhotoVaultLocked(true, false)).toBe(false);
  });
});
