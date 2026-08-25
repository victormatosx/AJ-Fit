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

  it('the provider value always reads `allowed \\? override : \'REAL\'` — never exposes a stale override when disallowed', () => {
    expect(SOURCE).toContain("override: allowed ? override : 'REAL'");
  });

  it('never touches RevenueCat, Firestore, or the backend directly', () => {
    for (const forbidden of ['Purchases.', 'firestore', 'httpsCallable', 'fetch(']) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('persistence goes exclusively through the gated storage module', () => {
    expect(SOURCE).toContain("from './subscriptionOverrideStorage'");
    expect(CODE).not.toContain('AsyncStorage');
  });
});
