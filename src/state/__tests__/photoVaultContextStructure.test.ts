import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Structural guarantees for the Photo Vault provider.
 *
 * The project has no component renderer, so the provider's wiring is
 * asserted against its source. These are not cosmetic checks: each one
 * corresponds to a rule that, if broken, silently weakens the lock — an
 * auto-unlock on foreground, a missing AppState listener, or a session that
 * survives an account change. Behaviour on a real device still has to be
 * verified in the physical test matrix (docs/20 §24).
 */

const CONTEXT = readFileSync('src/state/PhotoVaultContext.tsx', 'utf8');
const APP = readFileSync('App.tsx', 'utf8');

/** Source with comments stripped, for assertions about what the code does. */
const CONTEXT_CODE = CONTEXT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('AppState wiring', () => {
  it('subscribes to AppState changes', () => {
    expect(CONTEXT_CODE).toContain("AppState.addEventListener('change'");
  });

  it('does not leave temporary lifecycle diagnostics in the release source', () => {
    expect(CONTEXT_CODE).not.toContain('logPhotoVaultDebug');
    expect(CONTEXT_CODE).not.toContain('console.');
  });

  it('routes every transition through the lifecycle state machine', () => {
    expect(CONTEXT_CODE).toContain('handlePhotoVaultAppStateChange(previous, next)');
  });

  it('revokes the session before scheduling the neutral overlay', () => {
    const backgroundBranch = CONTEXT_CODE.slice(
      CONTEXT_CODE.indexOf('handlePhotoVaultAppStateChange(previous, next)'),
      CONTEXT_CODE.indexOf("requestAnimationFrame(() =>"),
    );

    expect(backgroundBranch.indexOf('handlePhotoVaultAppStateChange')).toBeGreaterThan(-1);
    expect(backgroundBranch.indexOf('handlePhotoVaultAppStateChange')).toBeLessThan(
      backgroundBranch.indexOf('setPrivacyOverlayVisible(true)'),
    );
  });

  it('never unlocks automatically when returning to the foreground', () => {
    // No call to unlock may be reachable from the AppState handler.
    const handler = CONTEXT_CODE.slice(
      CONTEXT_CODE.indexOf("AppState.addEventListener('change'"),
      CONTEXT_CODE.indexOf('return () => subscription.remove()'),
    );

    expect(handler).not.toContain('unlockPhotoVault');
    // Foreground work is allowed only to remove the privacy overlay and
    // capture protection after the locked frame; it must never auto-unlock.
    expect(handler).toContain('deactivatePhotoVaultScreenProtection');
  });

  it('renders the locked tree before releasing the neutral overlay on foreground', () => {
    const foreground = CONTEXT_CODE.slice(
      CONTEXT_CODE.indexOf("if (next !== 'active')"),
      CONTEXT_CODE.indexOf('const unsubscribeShareHandoff'),
    );
    expect(foreground).toContain('requestAnimationFrame');
    expect(foreground.indexOf('setPrivacyOverlayVisible(false)')).toBeLessThan(
      foreground.indexOf('deactivateScreenProtectionIfSafe()'),
    );
  });

  it('defers only native release while the generic share handoff owns its window', () => {
    expect(CONTEXT_CODE).toContain('isPhotoVaultComparisonShareInFlight()');
    expect(CONTEXT_CODE).toContain('subscribeToPhotoVaultComparisonShareInFlight');
    const guard = CONTEXT_CODE.slice(
      CONTEXT_CODE.indexOf('const deactivateScreenProtectionIfSafe'),
      CONTEXT_CODE.indexOf('useEffect(() => subscribeToPhotoVaultStatus'),
    );
    expect(guard).toContain('canReleasePhotoVaultScreenProtection');
    expect(guard).toContain('appState: appStateRef.current');
    expect(guard).toContain('vaultStatus: getPhotoVaultStatus()');
    expect(guard).toContain('isPhotoVaultComparisonShareInFlight()');
  });

  it('removes the listener on unmount', () => {
    expect(CONTEXT_CODE).toContain('subscription.remove()');
  });
});

describe('identity changes', () => {
  it('locks whenever the uid changes', () => {
    expect(CONTEXT_CODE).toMatch(/useEffect\(\(\) => \{\s*lockPhotoVault\(\);/);
    expect(CONTEXT_CODE).toMatch(/\}, \[uid\]\)/);
  });

  it('reads the uid from the auth context, not from a parameter', () => {
    expect(CONTEXT_CODE).toContain('useAuth()');
    expect(CONTEXT_CODE).toContain('user?.uid ?? null');
  });

  it('clears every cached namespace that is not the signed-in one', () => {
    // Keyed on who IS signed in, so a logout (null) keeps nothing and an
    // account switch cannot leave the previous user's ciphertext behind —
    // without having to remember who was signed in before.
    expect(CONTEXT_CODE).toContain('pruneCachedThumbnailsExcept(uid)');
  });

  it('closes the session before clearing the cache', () => {
    const effect = CONTEXT_CODE.slice(CONTEXT_CODE.indexOf('lockPhotoVault();'));
    const lockAt = effect.indexOf('lockPhotoVault();');
    const pruneAt = effect.indexOf('pruneCachedThumbnailsExcept(uid)');
    // Ordering is the race guard: locking bumps the session generation and the
    // prune bumps the cache epoch, so an in-flight download from the previous
    // session fails both checks instead of recreating what was just removed.
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(pruneAt).toBeGreaterThan(lockAt);
  });

  /**
   * Anchored on `pruneCachedThumbnailsExcept(uid)`, which appears exactly
   * once in the file (unlike `lockPhotoVault();`, which also opens the
   * unrelated `lock` callback higher up) — a reliable start-of-slice marker
   * for the identity-change effect specifically.
   */
  function identityEffectFrom(code: string): string {
    const start = code.indexOf('pruneCachedThumbnailsExcept(uid)');
    return code.slice(start, code.indexOf('}, [uid]);', start));
  }

  it('also clears the Comparator export queue on identity change (phase 15B)', () => {
    // Unlike a lock/background transition, an identity change is a real
    // session boundary: no export queued by the previous account may reach
    // the next one. See the doc comment on `cleanupPhotoVaultShareFiles`.
    const effect = identityEffectFrom(CONTEXT_CODE);
    expect(effect).toContain('cleanupPhotoVaultShareFiles()');
  });

  it('does not let a share-sweep failure skip resetting capability/lastIssue', () => {
    // A filesystem error must not throw uncaught inside the identity effect.
    const effect = identityEffectFrom(CONTEXT_CODE);
    expect(effect).toContain('try {');
    expect(effect).toContain('cleanupPhotoVaultShareFiles();');
    expect(effect).toContain('} catch {');
    expect(effect.indexOf('setCapability(null);')).toBeGreaterThan(
      effect.indexOf('cleanupPhotoVaultShareFiles();'),
    );
  });
});

describe('no persistence and no bypass', () => {
  it('never persists the unlocked state', () => {
    expect(CONTEXT).not.toContain('AsyncStorage');
    expect(CONTEXT).not.toContain('SecureStore');
    expect(CONTEXT).not.toContain('expo-file-system');
  });

  it('never opens a session directly, only through the lock module', () => {
    // Bypassing photoVaultLock would skip authentication entirely.
    expect(CONTEXT).not.toContain('openPhotoVaultSession');
  });

  it('exposes no way to disable the protection', () => {
    expect(CONTEXT).not.toMatch(/disable|skipAuth|bypass|allowWithout/i);
  });

  it('starts from the lock module state rather than assuming unlocked', () => {
    expect(CONTEXT_CODE).toContain('useState<PhotoVaultStatus>(getPhotoVaultStatus)');
  });
});

describe('mounted in the app', () => {
  it('wraps the navigator', () => {
    expect(APP).toContain('<PhotoVaultProvider>');
    expect(APP).toContain('</PhotoVaultProvider>');
  });

  it('sits inside the auth provider so it can react to sign-out', () => {
    expect(APP.indexOf('<AuthProvider>')).toBeLessThan(APP.indexOf('<PhotoVaultProvider>'));
  });
});
