import { describe, expect, it } from 'vitest';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { onboardingSafetyBlock } from '../onboardingSafetyGate';

describe('onboarding safety gate', () => {
  it.each([
    ['postpartumReturnClearance', completeAnswers({
      sex: 'f',
      specialConditions: ['postpartum'],
      postpartumScreening: { timeSinceBirth: '3_6_months', deliveryType: 'vaginal', signs: ['none'], returnClearance: 'not_yet' },
    })],
    ['postSurgicalStatus', completeAnswers({
      specialConditions: ['post_surgical'],
      postSurgicalScreening: { recoveryStatus: 'in_progress', bodyRegion: 'knee', returnClearance: 'not_yet' },
    })],
    ['dizzinessScreening', completeAnswers({
      specialConditions: ['dizziness_or_vertigo'],
      dizzinessScreening: { symptomFrequency: 'frequent', affectsBalance: 'no' },
    })],
  ] as const)('blocks %s when the existing engine requires clearance', (step, answers) => {
    expect(onboardingSafetyBlock(step, answers)).toBe('REQUIRES_CLEARANCE');
  });

  it('blocks documented pregnancy warning signs', () => {
    const answers = completeAnswers({
      sex: 'f',
      specialConditions: ['pregnancy'],
      pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['chest_pain'] },
    });
    expect(onboardingSafetyBlock('pregnancyWarningSigns', answers)).toBe('BLOCKED');
  });

  it('does not invent a gate for an adapted or clear outcome', () => {
    expect(onboardingSafetyBlock('postpartumReturnClearance', completeAnswers({
      sex: 'f',
      specialConditions: ['postpartum'],
      postpartumScreening: { timeSinceBirth: 'over_1_year', deliveryType: 'vaginal', signs: ['none'], returnClearance: 'yes' },
    }))).toBeNull();
  });
});
