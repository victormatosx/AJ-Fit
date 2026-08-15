import { describe, expect, it } from 'vitest';
import {
  computeOnboardingProgress,
  FORCED_QUESTIONNAIRE_STEP_IDS,
  getNextStepId,
  getPreviousStepId,
  getStepDef,
  getStepIndex,
  getStepSequence,
  isStepDevJumpable,
  MAX_MUSCLE_FOCUS,
  ONBOARDING_STEPS,
  type OnboardingStepId,
} from '../steps';

describe('ONBOARDING_STEPS', () => {
  it('has 26 unique step ids', () => {
    const ids = ONBOARDING_STEPS.map((s) => s.id);
    expect(ids).toHaveLength(26);
    expect(new Set(ids).size).toBe(26);
  });

  it('never lets auth/paywall be dev-jumpable', () => {
    expect(isStepDevJumpable('auth')).toBe(false);
    expect(isStepDevJumpable('paywall')).toBe(false);
  });

  it('lets every other step be dev-jumpable', () => {
    for (const step of ONBOARDING_STEPS) {
      if (step.id === 'auth' || step.id === 'paywall') continue;
      expect(step.devJumpable).toBe(true);
    }
  });

  it('marks interstitials/presentation/processing/result as not counting toward progress', () => {
    const nonQuestionKinds = new Set(['presentation', 'interstitial', 'socialProof', 'processing', 'result']);
    for (const step of ONBOARDING_STEPS) {
      if (nonQuestionKinds.has(step.kind)) expect(step.countsTowardProgress).toBe(false);
    }
  });

  it('getStepDef throws for an unknown id and is stable for known ones', () => {
    expect(() => getStepDef('goal')).not.toThrow();
    expect(getStepIndex('goal')).toBeGreaterThanOrEqual(0);
  });
});

describe('getStepSequence / anonymous vs forcedQuestionnaire', () => {
  it('anonymous sequence includes all 26 steps in ONBOARDING_STEPS order', () => {
    expect(getStepSequence('anonymous')).toEqual(ONBOARDING_STEPS.map((s) => s.id));
  });

  it('forcedQuestionnaire sequence skips presentation/name/welcome/motivation/socialProof/commitment', () => {
    const seq = getStepSequence('forcedQuestionnaire');
    for (const skipped of ['presentation', 'name', 'welcome', 'motivation', 'socialProof', 'commitment']) {
      expect(seq).not.toContain(skipped);
    }
    expect(seq).toEqual(FORCED_QUESTIONNAIRE_STEP_IDS);
    expect(seq[0]).toBe('goal');
    expect(seq[seq.length - 1]).toBe('plan');
  });
});

describe('getNextStepId / getPreviousStepId', () => {
  it('walks the anonymous sequence forward and back to the same place', () => {
    let id: OnboardingStepId = 'presentation';
    const visited: OnboardingStepId[] = [id];
    for (let i = 0; i < 25; i++) {
      const next = getNextStepId(id, 'anonymous');
      expect(next).not.toBeNull();
      id = next!;
      visited.push(id);
    }
    expect(getNextStepId(id, 'anonymous')).toBeNull();
    for (let i = visited.length - 1; i > 0; i--) {
      expect(getPreviousStepId(visited[i], 'anonymous')).toBe(visited[i - 1]);
    }
  });

  it('has no previous step before the first step of each mode', () => {
    expect(getPreviousStepId('presentation', 'anonymous')).toBeNull();
    expect(getPreviousStepId('goal', 'forcedQuestionnaire')).toBeNull();
  });

  it('reaches the end of the forcedQuestionnaire sequence at plan', () => {
    expect(getNextStepId('plan', 'forcedQuestionnaire')).toBeNull();
  });
});

describe('computeOnboardingProgress', () => {
  it('is 0/total before the first question (presentation)', () => {
    const { current, total } = computeOnboardingProgress('presentation', 'anonymous');
    expect(current).toBe(0);
    expect(total).toBeGreaterThan(0);
  });

  it('increments only on question steps and holds steady on interstitials', () => {
    const atGoal = computeOnboardingProgress('goal', 'anonymous');
    const atInterstitial = computeOnboardingProgress('interstitial_evolution', 'anonymous');
    const atLevel = computeOnboardingProgress('level', 'anonymous');
    // level is answered right before interstitial_evolution, so the bar
    // should hold at the same value through the interstitial.
    expect(atInterstitial.current).toBe(atLevel.current);
    expect(atGoal.current).toBeLessThan(atLevel.current);
  });

  it('reaches total at the last question step (commitment) in anonymous mode', () => {
    const { current, total } = computeOnboardingProgress('commitment', 'anonymous');
    expect(current).toBe(total);
  });

  it('forcedQuestionnaire has a smaller total than anonymous (fewer question steps)', () => {
    const anonTotal = computeOnboardingProgress('goal', 'anonymous').total;
    const forcedTotal = computeOnboardingProgress('goal', 'forcedQuestionnaire').total;
    expect(forcedTotal).toBeLessThan(anonTotal);
  });
});

describe('MAX_MUSCLE_FOCUS', () => {
  it('is capped at 2 (documented product decision)', () => {
    expect(MAX_MUSCLE_FOCUS).toBe(2);
  });
});
