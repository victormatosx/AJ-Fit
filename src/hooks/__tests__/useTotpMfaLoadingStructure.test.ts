import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the TwoFactorSettingsScreen reactivation flash
 * (docs/23_navegacao_e_lifecycle.md §10): entering the screen a 2nd+ time
 * called `mfa.refresh()` on activation, and `refresh()` used to call
 * `setLoading(true)` on every single invocation — tearing the
 * already-resolved factor list/status text down to a full loading state on
 * every reactivation, then re-resolving a moment later. Root cause was
 * `loading` conflating "never resolved for this identity" with "a fetch is
 * in flight right now" — two semantically different things (docs/23 §10's
 * "initialStatusLoading vs. refreshing" distinction).
 *
 * These assertions read `useTotpMfa.ts` directly — no component renderer in
 * this Node-only suite (vitest.config.mts). The actual first-frame
 * behavior (loading visible, "Ativar" never flashing) needs the
 * manual/device pass described in the delivery report; `hasIdentityChanged`
 * (src/lib/mfaTotp.ts) carries the one piece of real logic behind this fix
 * and is unit-tested directly in src/lib/__tests__/mfaTotp.test.ts.
 */

const SOURCE = readFileSync('src/hooks/useTotpMfa.ts', 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function block(startMarker: string): string {
  const start = CODE.indexOf(startMarker);
  expect(start, `"${startMarker}" not found in useTotpMfa.ts`).toBeGreaterThan(-1);
  return CODE.slice(start, CODE.indexOf('}, [', start));
}

describe('useTotpMfa loading/refreshing separation', () => {
  it('never calls setLoading inside refresh() — only setRefreshing runs on every fetch', () => {
    const refreshBody = block('const refresh = useCallback(async (): Promise<boolean> => {');
    expect(refreshBody).not.toContain('setLoading(true)');
    expect(refreshBody).toContain('setRefreshing(true)');
    expect(refreshBody).toContain('setRefreshing(false)');
    // The one exception: refresh() DOES flip loading false at the end —
    // that's the one-way exit from "unresolved", not a re-entry into it.
    expect(refreshBody).toContain('setLoading(false)');
  });

  it('only resets to the unresolved/loading state on a genuine identity change', () => {
    const effectBody = CODE.slice(
      CODE.indexOf('useEffect(() => {', CODE.indexOf('const prevUidRef')),
      CODE.indexOf('}, [refresh, refreshToken, user?.uid])'),
    );
    const identityBranch = effectBody.slice(
      effectBody.indexOf('if (identityChanged) {'),
      effectBody.indexOf('}', effectBody.indexOf('if (identityChanged) {')) + 1,
    );
    expect(identityBranch).toContain('setLoading(true)');
    expect(identityBranch).toContain('setFactors([])');
    // Outside the identityChanged branch (still inside the effect, runs on
    // every refreshToken bump too): must NOT reset loading or factors.
    const afterBranch = effectBody.slice(effectBody.indexOf('}', effectBody.indexOf('if (identityChanged) {')) + 1);
    expect(afterBranch).not.toContain('setLoading(true)');
    expect(afterBranch).not.toContain('setFactors([])');
  });

  it('uses the pure hasIdentityChanged decision instead of an inline comparison', () => {
    expect(CODE).toContain(
      "import {\n  hasIdentityChanged,",
    );
    expect(CODE).toContain('hasIdentityChanged(prevUidRef.current, uid)');
  });

  it('exposes both loading (unresolved) and refreshing (in-flight) to consumers', () => {
    expect(CODE).toMatch(/return \{[\s\S]*loading,[\s\S]*refreshing,[\s\S]*\};/);
  });
});
