import { describe,expect,it } from 'vitest';
import { evaluateSafety } from '../safety';
import { completeAnswers } from './fixtures';

describe('safety engine', () => {
  const postSurgical = (recoveryStatus: 'completed' | 'in_progress' | 'unsure', returnClearance: 'cleared_no_restrictions' | 'cleared_with_restrictions' | 'not_yet' | 'unsure') =>
    completeAnswers({ specialConditions: ['post_surgical'], postSurgicalScreening: { recoveryStatus, returnClearance, bodyRegion: 'knee' } });

  it.each([
    ['completed', 'cleared_no_restrictions', 'CLEAR'],
    ['in_progress', 'cleared_with_restrictions', 'REQUIRES_CLEARANCE'],
    ['in_progress', 'not_yet', 'REQUIRES_CLEARANCE'],
    ['in_progress', 'unsure', 'REQUIRES_CLEARANCE'],
    ['in_progress', 'cleared_no_restrictions', 'ADAPTED'],
    ['unsure', 'cleared_no_restrictions', 'REQUIRES_CLEARANCE'],
  ] as const)('post-surgical %s + %s => %s', (status, clearance, expected) => {
    expect(evaluateSafety(postSurgical(status, clearance)).status).toBe(expected);
  });

  it.each([
    ['history_only', 'no', 'CLEAR'],
    ['occasional', 'no', 'ADAPTED'],
    ['frequent', 'no', 'REQUIRES_CLEARANCE'],
    ['history_only', 'yes', 'REQUIRES_CLEARANCE'],
    ['current_or_recent', 'no', 'REQUIRES_CLEARANCE'],
  ] as const)('dizziness %s + balance %s => %s', (frequency, balance, expected) => {
    const result = evaluateSafety(completeAnswers({
      specialConditions: ['dizziness_or_vertigo'],
      dizzinessScreening: { symptomFrequency: frequency, affectsBalance: balance },
    }));
    expect(result.status).toBe(expected);
  });

  it.each([
    ['none', 'no', 'CLEAR'],
    ['mild_or_occasional', 'no', 'ADAPTED'],
    ['interferes_with_exercises', 'no', 'ADAPTED'],
    ['none', 'yes', 'REQUIRES_CLEARANCE'],
  ] as const)('lipedema %s + guidance %s => %s', (impact, guidance, expected) => {
    expect(evaluateSafety(completeAnswers({
      specialConditions: ['lipedema'], lipedemaScreening: { symptomImpact: impact, professionalGuidance: guidance },
    })).status).toBe(expected);
  });

  it('blocks only the documented pregnancy red flags', () => {
    const pregnancy = completeAnswers({
      sex: 'f', specialConditions: ['pregnancy'],
      pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['vaginal_bleeding'] },
    });
    expect(evaluateSafety(pregnancy).status).toBe('BLOCKED');
  });

  it.each([
    ['pregnancy', 'ADAPTED'],
    ['postpartum', 'ADAPTED'],
    ['functional', 'ADAPTED'],
    ['medical', 'REQUIRES_CLEARANCE'],
  ] as const)('%s population/restriction resolves to %s', (scenario, expected) => {
    const answers = scenario === 'pregnancy'
      ? completeAnswers({
          sex: 'f', specialConditions: ['pregnancy'],
          pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] },
        })
      : scenario === 'postpartum'
        ? completeAnswers({
            sex: 'f', specialConditions: ['postpartum'],
            postpartumScreening: { timeSinceBirth: 'over_1_year', deliveryType: 'vaginal', signs: ['none'], returnClearance: 'yes' },
          })
        : scenario === 'functional'
          ? completeAnswers({
              specialConditions: ['functional_limitation'], functionalScreening: { situations: ['support_needed'] },
            })
          : completeAnswers({
              specialConditions: ['medical_restriction'], medicalRestrictionScreening: { professionalExerciseRestriction: 'yes' },
            });
    expect(evaluateSafety(answers).status).toBe(expected);
  });

  it('never lets a lower-priority adapted condition weaken clearance', () => {
    const result = evaluateSafety(completeAnswers({
      specialConditions: ['dizziness_or_vertigo', 'lipedema'],
      dizzinessScreening: { symptomFrequency: 'frequent', affectsBalance: 'no' },
      lipedemaScreening: { symptomImpact: 'mild_or_occasional', professionalGuidance: 'no' },
    }));
    expect(result.status).toBe('REQUIRES_CLEARANCE');
  });
});
