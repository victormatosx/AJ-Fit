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
  it('has 39 unique step ids', () => {
    const ids = ONBOARDING_STEPS.map((s) => s.id);
    expect(ids).toHaveLength(39);
    expect(new Set(ids).size).toBe(39);
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
  it('static anonymous sequence includes every registered step in order', () => {
    expect(getStepSequence('anonymous')).toEqual(ONBOARDING_STEPS.map((s) => s.id));
  });

  it('forcedQuestionnaire sequence skips presentation/name/welcome/socialProof/commitment', () => {
    const seq = getStepSequence('forcedQuestionnaire');
    for (const skipped of ['presentation', 'name', 'welcome', 'socialProof', 'commitment']) {
      expect(seq).not.toContain(skipped);
    }
    expect(seq).toEqual(FORCED_QUESTIONNAIRE_STEP_IDS);
    expect(seq[0]).toBe('sex');
    expect(seq[seq.length - 1]).toBe('plan');
  });
});

describe('getNextStepId / getPreviousStepId', () => {
  it('walks the anonymous sequence forward, and back never lands on an auto-advancing kind', () => {
    const skipKinds = ['interstitial', 'socialProof', 'processing'];
    let id: OnboardingStepId = 'presentation';
    const visited: OnboardingStepId[] = [id];
    for (let i = 0; i < ONBOARDING_STEPS.length - 1; i++) {
      const next = getNextStepId(id, 'anonymous');
      expect(next).not.toBeNull();
      id = next!;
      visited.push(id);
    }
    expect(getNextStepId(id, 'anonymous')).toBeNull();
    for (const stepId of visited) {
      const prev = getPreviousStepId(stepId, 'anonymous');
      if (prev) expect(skipKinds).not.toContain(getStepDef(prev).kind);
    }
  });

  it('back from a question after an interstitial skips straight to the prior question', () => {
    // presentation -> name -> welcome(interstitial) -> sex
    expect(getPreviousStepId('sex', 'anonymous')).toBe('name');
    // level -> evolution/methodology interstitials -> days
    expect(getPreviousStepId('days', 'anonymous')).toBe('level');
    // place -> guided interstitial -> muscleFocus
    expect(getPreviousStepId('muscleFocus', 'anonymous', { place: 'gym', specialConditions: ['none'] })).toBe('place');
    // specialConditions -> AJ progress/social proof -> commitment
    expect(getPreviousStepId('commitment', 'anonymous', { place: 'gym', specialConditions: ['none'] })).toBe('specialConditions');
  });

  it('has no previous step before the first step of each mode', () => {
    expect(getPreviousStepId('presentation', 'anonymous')).toBeNull();
    expect(getPreviousStepId('sex', 'forcedQuestionnaire')).toBeNull();
  });

  it('reaches the end of the forcedQuestionnaire sequence at plan', () => {
    expect(getNextStepId('plan', 'forcedQuestionnaire')).toBeNull();
  });

  it('Fase 5: healthIntegration sits right between muscleFocus and specialConditions, in anonymous mode only', () => {
    expect(getNextStepId('muscleFocus', 'anonymous')).toBe('healthIntegration');
    expect(getNextStepId('healthIntegration', 'anonymous')).toBe('specialConditions');
    expect(getPreviousStepId('healthIntegration', 'anonymous')).toBe('muscleFocus');
    expect(getNextStepId('plan', 'anonymous')).toBe('auth');
    // forcedQuestionnaire is for an already-authenticated account — the
    // step never appears there (see steps.ts's doc comment on the entry).
    expect(FORCED_QUESTIONNAIRE_STEP_IDS).not.toContain('healthIntegration');
    expect(getStepSequence('forcedQuestionnaire')).not.toContain('healthIntegration');
  });

  it('Fase 5: healthIntegration is dev-jumpable, like every other non-auth/paywall step', () => {
    expect(isStepDevJumpable('healthIntegration')).toBe(true);
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

  it('holds steady (not yet at total) at healthIntegration — commitment is still the last counted step', () => {
    const { current, total } = computeOnboardingProgress('healthIntegration', 'anonymous');
    expect(current).toBeLessThan(total);
  });

  it('reaches total at commitment, the real last question, in anonymous mode', () => {
    const { current, total } = computeOnboardingProgress('commitment', 'anonymous');
    expect(current).toBe(total);
  });

  it('forcedQuestionnaire has a smaller total than anonymous (fewer question steps)', () => {
    const anonTotal = computeOnboardingProgress('goal', 'anonymous').total;
    const forcedTotal = computeOnboardingProgress('goal', 'forcedQuestionnaire').total;
    expect(forcedTotal).toBeLessThan(anonTotal);
  });
});

describe('conditional questionnaire branches', () => {
  const standard = { place: 'gym', limits: [], specialConditions: ['none'] };

  it('keeps the standard path compact', () => {
    const seq = getStepSequence('anonymous', standard);
    expect(seq).not.toContain('equipment');
    expect(seq).not.toContain('limits');
    expect(seq).not.toContain('pregnancyWeeks');
    expect(seq).not.toContain('postpartumSigns');
    expect(seq).not.toContain('functionalSituations');
  });

  it('keeps standard male and female paths identical when the health router is none', () => {
    const male = getStepSequence('anonymous', { ...standard, sex: 'm' });
    const female = getStepSequence('anonymous', { ...standard, sex: 'f' });
    expect(female).toEqual(male);
    expect(female.filter((id) => getStepDef(id).kind === 'question')).toHaveLength(13);
  });

  it('never shows the equipment step, for any place — v1.27 does not collect a home equipment inventory', () => {
    for (const place of ['gym', 'home'] as const) {
      expect(getStepSequence('anonymous', { ...standard, place })).not.toContain('equipment');
      expect(getStepSequence('forcedQuestionnaire', { ...standard, place })).not.toContain('equipment');
    }
  });

  it('going straight from place to the next valid question skips equipment cleanly (no dead-end, no phantom step)', () => {
    // place -> interstitial_guidedWorkout -> muscleFocus. Home users should
    // land on the interstitial exactly like gym users, never on `equipment`.
    expect(getNextStepId('place', 'anonymous', { ...standard, place: 'home' })).toBe('interstitial_guidedWorkout');
    expect(getNextStepId('place', 'anonymous', { ...standard, place: 'gym' })).toBe('interstitial_guidedWorkout');
  });

  it('back-navigation for a home user skips equipment and never lands on it', () => {
    expect(getPreviousStepId('muscleFocus', 'anonymous', { ...standard, place: 'home' })).toBe('place');
    expect(getPreviousStepId('muscleFocus', 'anonymous', { ...standard, place: 'gym' })).toBe('place');
  });

  it('progress denominator/position is identical for home and gym (equipment never counted)', () => {
    const homeProgress = computeOnboardingProgress('place', 'anonymous', { ...standard, place: 'home' });
    const gymProgress = computeOnboardingProgress('place', 'anonymous', { ...standard, place: 'gym' });
    expect(homeProgress).toEqual(gymProgress);
  });

  it('adds limitation regions directly and coexisting pregnancy/functional screening', () => {
    const seq = getStepSequence('anonymous', {
      place: 'gym',
      limits: ['knee'],
      specialConditions: ['musculoskeletal_limitation', 'pregnancy', 'functional_limitation'],
    });
    expect(seq).toContain('limits');
    expect(seq).toContain('pregnancyCare');
    expect(seq).toContain('functionalSituations');
    expect(getStepSequence('anonymous', { ...standard, specialConditions: ['postpartum'] })).toContain(
      'postpartumReturnClearance',
    );
  });

  it('uses the applicable path as the progress denominator', () => {
    const standardTotal = computeOnboardingProgress('goal', 'anonymous', standard).total;
    const pregnancyTotal = computeOnboardingProgress('goal', 'anonymous', {
      ...standard,
      specialConditions: ['pregnancy'],
    }).total;
    expect(pregnancyTotal).toBe(standardTotal + 3);
  });

  it('routes and combines every phase 2 health branch', () => {
    const seq = getStepSequence('anonymous', {
      ...standard,
      specialConditions: ['lipedema', 'dizziness_or_vertigo', 'post_surgical', 'medical_restriction'],
    });
    expect(seq).toEqual(expect.arrayContaining([
      'lipedemaScreening',
      'dizzinessScreening',
      'postSurgicalStatus',
      'postSurgicalRegion',
      'medicalRestrictionDetails',
    ]));
  });

  it.each([
    ['lipedema', ['lipedemaScreening']],
    ['dizziness_or_vertigo', ['dizzinessScreening']],
    ['post_surgical', ['postSurgicalStatus', 'postSurgicalRegion']],
  ] as const)('opens only the %s-specific phase 2 screens', (condition, expected) => {
    const seq = getStepSequence('anonymous', { ...standard, specialConditions: [condition] });
    const phase2Ids = ['lipedemaScreening', 'dizzinessScreening', 'postSurgicalStatus', 'postSurgicalRegion'];
    expect(seq.filter((id) => phase2Ids.includes(id))).toEqual(expected);
  });

  it('combines lipedema and musculoskeletal details without duplicating screens', () => {
    const seq = getStepSequence('anonymous', {
      ...standard,
      limits: ['knee'],
      specialConditions: ['lipedema', 'musculoskeletal_limitation'],
    });
    for (const id of ['limits', 'lipedemaScreening'] as const) {
      expect(seq.filter((stepId) => stepId === id)).toHaveLength(1);
    }
  });
});

describe('unified weekly schedule step', () => {
  it('keeps only days in both funnel modes and removes the redundant legacy screens', () => {
    for (const mode of ['anonymous', 'forcedQuestionnaire'] as const) {
      const sequence = getStepSequence(mode);
      expect(sequence).toContain('days');
      expect(sequence).not.toContain('scheduleMode');
      expect(sequence).not.toContain('trainingDays');
    }
  });

  it('navigates directly from days to duration', () => {
    expect(getNextStepId('days', 'anonymous')).toBe('duration');
    expect(getPreviousStepId('duration', 'anonymous')).toBe('days');
  });
});

describe('MAX_MUSCLE_FOCUS', () => {
  it('is capped at 2 (documented product decision)', () => {
    expect(MAX_MUSCLE_FOCUS).toBe(2);
  });
});
