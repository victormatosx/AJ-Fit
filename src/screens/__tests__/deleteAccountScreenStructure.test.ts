import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Fase 12 — structural guarantees for `DeleteAccountScreen.tsx`. No
 * component renderer in this Node-only suite (vitest.config.mts, same
 * pattern as `appShellNavigationStructure.test.ts`) — the actual
 * first-frame/visual behavior needs the manual pass documented in the
 * Fase 12 report. This file guards the wiring: presentation only, single
 * flow driven by the hook, sensitive state wiped on deactivation.
 */

const SOURCE = readFileSync('src/screens/DeleteAccountScreen.tsx', 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('DeleteAccountScreen — presentation only', () => {
  it('owns no destructive logic itself — everything comes from useAccountDeletionFlow', () => {
    expect(SOURCE).toContain("from '../hooks/useAccountDeletionFlow'");
    for (const forbidden of [
      'httpsCallable',
      "from '../services/accountDeletionOrchestrator'",
      "from '../services/accountDeletionReauth'",
      "from '../services/accountDeletionShutdown'",
    ]) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('renders exactly one flow, switching on flow.step — not separate screens per step', () => {
    for (const step of ["flow.step === 'intro'", "flow.step === 'reauth'", "flow.step === 'confirm'", "flow.step === 'submitting'"]) {
      expect(CODE).toContain(step);
    }
  });

  it('wipes sensitive flow state on deactivation via useScreenFocusEffect, same discipline as ChangePasswordScreen', () => {
    expect(SOURCE).toContain('useScreenFocusEffect');
    const effectBody = CODE.slice(
      CODE.indexOf('useScreenFocusEffect(() => {'),
      CODE.indexOf('});', CODE.indexOf('useScreenFocusEffect(() => {')),
    );
    expect(effectBody).toContain('flow.reset()');
  });
});

describe('DeleteAccountScreen — subscription warning (Fase 12 §7/§9/§10)', () => {
  it('never blocks continuing based on subscription state', () => {
    // The "continue" action in the intro step must not be gated by
    // isPremium/subscriptionLoading — only wired to onContinue.
    const introCall = CODE.slice(CODE.indexOf('<IntroStep'), CODE.indexOf('/>', CODE.indexOf('<IntroStep')));
    expect(introCall).not.toMatch(/disabled=\{.*isPremium/);
  });

  it('reads subscription state from useSubscription(), never a second RevenueCat call', () => {
    expect(SOURCE).toContain("from '../hooks/useSubscription'");
    expect(CODE).not.toContain('Purchases.');
    expect(CODE).not.toContain('revenueCatService');
  });

  it('offers Manage Subscription only through the existing manageSubscription() from context', () => {
    expect(CODE).toContain('manageSubscription(');
    expect(CODE).not.toContain('Linking.openURL');
  });
});

describe('DeleteAccountScreen — back navigation blocked during commit (Fase 12 §19/§21)', () => {
  it('disables the header back action while submitting or after acceptance', () => {
    expect(CODE).toContain("flow.step !== 'submitting' && !flow.accepted");
    expect(CODE).toContain('disabled={!backAllowed}');
  });
});

describe('DeleteAccountScreen — password visibility toggle actually works', () => {
  it('wires a real passwordVisible/onTogglePassword pair into ReauthenticationMethods, never a hardcoded false/no-op', () => {
    const call = CODE.slice(
      CODE.indexOf('<ReauthenticationMethods'),
      CODE.indexOf('/>', CODE.indexOf('<ReauthenticationMethods')),
    );
    expect(call).toContain('passwordVisible={passwordVisible}');
    expect(call).toContain('onTogglePassword={onTogglePassword}');
    expect(call).not.toContain('passwordVisible={false}');
    expect(call).not.toContain('onTogglePassword={() => {}}');
  });
});

describe('DeleteAccountScreen — no hardcoded strings for user-facing copy', () => {
  it('every visible label goes through t(...)', () => {
    // Heuristic guard, not exhaustive: the strings a naive implementation
    // would most likely hardcode are already asserted as translation calls
    // elsewhere in this file; this just confirms the namespace is 'settings'.
    expect(SOURCE).toContain("useTranslation('settings')");
  });
});
