import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Fase 2 (docs/13_assinaturas_e_billing.md): this suite is source-inspection
 * based like the other source-inspection suites — no component renderer in
 * this Node-only suite (vitest.config.mts). The behavioral guarantees (pure,
 * deterministic, no independent state) are covered directly, with real
 * inputs, by `src/lib/__tests__/premiumCapabilities.test.ts`; this file only
 * asserts that the React wiring stays a thin derivation of
 * `useSubscription()` and never grows a second source of truth.
 */
const HOOK_SOURCE = readFileSync('src/hooks/usePremiumCapabilities.ts', 'utf8');
// Strip comments before the "never touches X" assertions below — the code's
// own doc comment names RevenueCat/Firestore/AsyncStorage to explain why the
// hook doesn't touch them, which would otherwise false-positive.
const HOOK_CODE = HOOK_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('usePremiumCapabilities wiring', () => {
  it('derives access exclusively from useSubscription() — loading/configured/isPremium', () => {
    expect(HOOK_SOURCE).toContain("import { useSubscription } from './useSubscription'");
    expect(HOOK_SOURCE).toContain(
      'const { loading, configured, isPremium } = useSubscription();',
    );
  });

  it('never touches RevenueCat, Firestore, or AsyncStorage directly', () => {
    for (const forbidden of [
      'Purchases.',
      'revenueCatService',
      'firestore',
      'AsyncStorage',
      'getCustomerInfo',
    ]) {
      expect(HOOK_CODE).not.toContain(forbidden);
    }
  });

  it('never keeps an independent useState for capabilities — access is a memoized derivation', () => {
    expect(HOOK_SOURCE).not.toContain('useState');
    expect(HOOK_SOURCE).toContain('useMemo');
  });

  it('treats "not yet resolved" as fail-closed, not as an omitted/optional field', () => {
    expect(HOOK_SOURCE).toContain('resolved: !loading && configured');
  });

  it('delegates the actual authorization decision to the pure domain function', () => {
    expect(HOOK_SOURCE).toContain(
      "import {\n  canPerformPremiumCapability,\n  type PremiumAccessState,\n  type PremiumCapability,\n} from '../lib/premiumCapabilities';",
    );
    expect(HOOK_SOURCE).toContain('canPerformPremiumCapability(capability, access)');
  });

  it('exposes canPerform(capability) typed against PremiumCapability, not a bare string', () => {
    expect(HOOK_SOURCE).toContain('(capability: PremiumCapability) =>');
    expect(HOOK_SOURCE).toMatch(/return \{ canPerform \};/);
  });
});
