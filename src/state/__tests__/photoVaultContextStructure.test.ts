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
