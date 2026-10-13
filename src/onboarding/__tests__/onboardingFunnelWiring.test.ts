import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const appRoot = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');
const funnelScreen = read('screens/OnboardingFunnelScreen.tsx');
const devNav = read('components/onboarding/DevFunnelNavigator.tsx');
const premiumGate = read('lib/premiumGate.ts');
const healthStepScreen = read('screens/onboarding/HealthIntegrationOnboardingScreen.tsx');

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

describe('Fase 5 — health integration is a native questionnaire step, not a post-paywall screen', () => {
  it('never reintroduces a dedicated RootScreenId for it — premiumGate.ts stays untouched by Fase 5', () => {
    const typeDecl = premiumGate.slice(
      premiumGate.indexOf('export type RootScreenId'),
      premiumGate.indexOf(';', premiumGate.indexOf('export type RootScreenId')),
    );
    expect(typeDecl).not.toContain("'healthIntegration'");
    expect(premiumGate).not.toContain('healthOnboardingGate');
  });

  it('plan calls onAuthRequested directly — healthIntegration no longer follows it in sequence', () => {
    const handlerBody = funnelScreen.slice(
      funnelScreen.indexOf('const handlePlanContinue = () => {'),
      funnelScreen.indexOf('};', funnelScreen.indexOf('const handlePlanContinue = () => {')),
    );
    expect(handlerBody).toContain('void onForcedQuestionnaireDone();');
    expect(handlerBody).toContain('onAuthRequested(');
  });

  it('healthIntegration now sits mid-funnel and just advances to the next question', () => {
    // The only two onAuthRequested call sites are presentation's "already
    // have an account" link and plan's continue action.
    const occurrences = funnelScreen.match(/onAuthRequested\(\{ origin:/g) ?? [];
    expect(occurrences).toHaveLength(2);
    const caseIdx = funnelScreen.indexOf("case 'healthIntegration':");
    const nextCaseIdx = funnelScreen.indexOf('case ', caseIdx + 1);
    expect(funnelScreen.slice(caseIdx, nextCaseIdx)).toContain('onNext={goNext}');
  });

  it('App.tsx never fabricates a connection — it only records the pre-auth choice into per-uid persistence', () => {
    expect(appRoot).toContain('markHealthIntegrationOnboardingPendingConfirmation');
    expect(appRoot).toContain('markHealthIntegrationOnboardingStepSeen');
    expect(appRoot).not.toContain('.connect()');
    expect(appRoot).not.toContain('requestHealthPermissions');
  });

  it('the draft is only ever cleared AFTER the choice is consumed, never racing it', () => {
    const effectBody = appRoot.slice(
      appRoot.indexOf('const healthIntegrationChoiceConsumedUidRef'),
      appRoot.indexOf("const repairHydratedUidRef"),
    );
    const consumeIdx = effectBody.indexOf('readOnboardingDraft()');
    const finallyIdx = effectBody.indexOf('.finally(');
    const clearIdx = effectBody.indexOf('void clearOnboardingDraft()', finallyIdx);
    expect(consumeIdx).toBeGreaterThan(-1);
    expect(finallyIdx).toBeGreaterThan(consumeIdx);
    expect(clearIdx).toBeGreaterThan(finallyIdx);
  });

  it('the questionnaire step itself never imports the native hook — it only records a choice, pre-auth', () => {
    expect(healthStepScreen).not.toContain("from '../../hooks/useHealthIntegration'");
    expect(healthStepScreen).not.toContain('.connect()');
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
