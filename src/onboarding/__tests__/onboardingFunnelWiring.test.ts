import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const appRoot = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');
const funnelScreen = read('screens/OnboardingFunnelScreen.tsx');
const devNav = read('components/onboarding/DevFunnelNavigator.tsx');
const premiumGate = read('lib/premiumGate.ts');

describe('App.tsx <-> onboarding funnel wiring', () => {
  it('routes an authenticated user without a questionnaire to forcedQuestionnaire mode', () => {
    expect(appRoot).toContain("mode={user ? 'forcedQuestionnaire' : 'anonymous'}");
  });

  it('only clears the anonymous draft once both user and questionnaire are real', () => {
    expect(appRoot).toContain('if (user && questionnaire) void clearOnboardingDraft();');
  });

  it('collapses the pre-auth funnel into a single RootScreenId', () => {
    const typeDecl = premiumGate.slice(
      premiumGate.indexOf('export type RootScreenId'),
      premiumGate.indexOf(';', premiumGate.indexOf('export type RootScreenId')),
    );
    expect(typeDecl).toContain("'onboardingFunnel'");
    for (const retired of ["'quiz'", "'socialProof'", "'analyzing'", "'plan'", "'onboarding'"]) {
      expect(typeDecl).not.toContain(retired);
    }
  });
});

describe('OnboardingFunnelScreen never fabricates auth/paywall', () => {
  it('has no case that mounts AuthScreen or PaywallScreen directly', () => {
    expect(funnelScreen).not.toContain('<AuthScreen');
    expect(funnelScreen).not.toContain('<PaywallScreen');
  });

  it('delegates to onAuthRequested / onForcedQuestionnaireDone instead', () => {
    expect(funnelScreen).toContain('onAuthRequested({ origin:');
    expect(funnelScreen).toContain('onForcedQuestionnaireDone');
  });
});

describe('DevFunnelNavigator production guard', () => {
  it('is double-guarded: once inside the component, once at every mount site', () => {
    expect(devNav).toContain('if (!__DEV__) return null;');
    expect(funnelScreen).toContain('{__DEV__ && <DevFunnelNavigator');
  });

  it('never allows jumping directly into auth or paywall', () => {
    expect(devNav).toContain('const disabled = !step.devJumpable;');
  });
});
