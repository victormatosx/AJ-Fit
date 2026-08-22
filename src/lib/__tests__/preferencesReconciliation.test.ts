import { describe, expect, it } from 'vitest';
import { needsPreferencesReconciliation } from '../preferencesReconciliation';

type Overrides = Partial<Parameters<typeof needsPreferencesReconciliation>[0]>;

function needs(overrides: Overrides = {}) {
  return needsPreferencesReconciliation({
    authInitializing: false,
    profileLoading: false,
    uid: 'uid-A',
    hasProfile: true,
    reconciledUid: null,
    ...overrides,
  });
}

describe('needsPreferencesReconciliation', () => {
  it('stays false while auth or profile is still loading — same neutral window as the gate itself', () => {
    expect(needs({ authInitializing: true })).toBe(false);
    expect(needs({ profileLoading: true })).toBe(false);
  });

  it('stays false without an authenticated uid or without a loaded profile yet', () => {
    expect(needs({ uid: null })).toBe(false);
    expect(needs({ hasProfile: false })).toBe(false);
  });

  it('root-cause fix: is TRUE on the very first render where profileLoading becomes false for a never-reconciled uid — no one-render lag', () => {
    // This is the exact moment the old effect-based flag was still `false`
    // (stale) for one extra render, letting resolvePremiumGate open to
    // 'app' before reconciliation had even started.
    expect(needs({ profileLoading: false, uid: 'uid-A', reconciledUid: null })).toBe(true);
  });

  it('is false once this uid has already been reconciled this session', () => {
    expect(needs({ uid: 'uid-A', reconciledUid: 'uid-A' })).toBe(false);
  });

  it('is true again for a DIFFERENT uid, even if the previous uid was already reconciled', () => {
    expect(needs({ uid: 'uid-B', reconciledUid: 'uid-A' })).toBe(true);
  });

  it('a background profile refresh for the SAME already-reconciled uid never re-triggers reconciliation', () => {
    // Mirrors EditProfileScreen calling refreshProfile(): uid is unchanged,
    // profile object may be a new reference, but reconciledUid already
    // matches — must stay false, unlike the old wasLoading-transition
    // effect which fired on every profileLoading transition regardless.
    expect(needs({ uid: 'uid-A', reconciledUid: 'uid-A', hasProfile: true })).toBe(false);
  });
});
