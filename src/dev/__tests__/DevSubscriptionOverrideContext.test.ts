import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-inspection suite (no React renderer in this Node-only vitest
 * config — same convention as `usePremiumCapabilities.test.ts`). Behavioral
 * coverage of the underlying gate/transform lives in
 * `subscriptionOverride.test.ts` / `subscriptionOverrideStorage.test.ts`;
 * this file asserts the context wiring never bypasses that gate.
 */
const SOURCE = readFileSync('src/dev/DevSubscriptionOverrideContext.tsx', 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('DevSubscriptionOverrideContext wiring', () => {
  it('derives `allowed` from the single hard gate, not its own re-implementation', () => {
    expect(SOURCE).toContain('isDevSubscriptionOverrideAllowed()');
  });

  it('setOverride is a no-op when not allowed — checked before any write', () => {
    expect(SOURCE).toMatch(/setOverride = useCallback\(\s*async \(next[\s\S]*?if \(!allowed\) return;/);
  });

  it('resolves the exposed override against both the current UID and allow gate', () => {
    expect(SOURCE).toContain('resolveDevSubscriptionOverrideForIdentity(session, uid, allowed)');
  });

  it('never touches RevenueCat, Firestore, or the backend directly', () => {
    for (const forbidden of ['Purchases.', 'firestore', 'httpsCallable', 'fetch(']) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('uses storage only for one-way legacy cleanup, never persistence', () => {
    expect(SOURCE).toContain("from './subscriptionOverrideStorage'");
    expect(SOURCE).toContain('clearLegacyStoredDevSubscriptionOverride()');
    expect(CODE).not.toMatch(/readStored|writeStored/);
    expect(CODE).not.toContain('AsyncStorage');
  });

  it('binds the session to AuthContext UID and resets when it changes', () => {
    expect(SOURCE).toContain('const { user } = useAuth()');
    expect(SOURCE).toContain('createDevSubscriptionOverrideSession(uid)');
    expect(SOURCE).toContain('if (session.uid === uid) return;');
  });
});
