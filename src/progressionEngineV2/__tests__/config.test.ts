import { describe, expect, it } from 'vitest';
import {
  PROGRESSION_V2_CONFIG,
  PROGRESSION_V2_CONFIG_QA_ACCELERATED,
  resolveProgressionV2Config,
} from '../config';

describe('resolveProgressionV2Config', () => {
  it('NORMAL resolves to the exact production constants, byte-for-byte', () => {
    expect(resolveProgressionV2Config('NORMAL')).toEqual(PROGRESSION_V2_CONFIG);
    expect(resolveProgressionV2Config('NORMAL')).toEqual({
      beginnerMinimumActiveDays: 28,
      intermediateAdvancedMinimumActiveDays: 85,
      adherenceEarnedThresholdBp: 7000,
      adherenceHighThresholdBp: 8500,
      motivationalRenewalExtensionDays: 30,
      intermediateCyclesForPromotion: 4,
      inactivityMissedOpportunityThreshold: 3,
      partialSessionMinSetCompletionPercent: 70,
    });
  });

  it('QA_ACCELERATED resolves to the QA constants', () => {
    expect(resolveProgressionV2Config('QA_ACCELERATED')).toEqual(PROGRESSION_V2_CONFIG_QA_ACCELERATED);
  });

  it('QA_ACCELERATED only compresses time windows — every rule-shaped constant is untouched', () => {
    expect(PROGRESSION_V2_CONFIG_QA_ACCELERATED.adherenceEarnedThresholdBp)
      .toBe(PROGRESSION_V2_CONFIG.adherenceEarnedThresholdBp);
    expect(PROGRESSION_V2_CONFIG_QA_ACCELERATED.adherenceHighThresholdBp)
      .toBe(PROGRESSION_V2_CONFIG.adherenceHighThresholdBp);
    expect(PROGRESSION_V2_CONFIG_QA_ACCELERATED.intermediateCyclesForPromotion)
      .toBe(PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion);
    expect(PROGRESSION_V2_CONFIG_QA_ACCELERATED.inactivityMissedOpportunityThreshold)
      .toBe(PROGRESSION_V2_CONFIG.inactivityMissedOpportunityThreshold);
    expect(PROGRESSION_V2_CONFIG_QA_ACCELERATED.partialSessionMinSetCompletionPercent)
      .toBe(PROGRESSION_V2_CONFIG.partialSessionMinSetCompletionPercent);
  });

  it('QA_ACCELERATED strictly shortens every time-window field', () => {
    expect(PROGRESSION_V2_CONFIG_QA_ACCELERATED.beginnerMinimumActiveDays)
      .toBeLessThan(PROGRESSION_V2_CONFIG.beginnerMinimumActiveDays);
    expect(PROGRESSION_V2_CONFIG_QA_ACCELERATED.intermediateAdvancedMinimumActiveDays)
      .toBeLessThan(PROGRESSION_V2_CONFIG.intermediateAdvancedMinimumActiveDays);
    expect(PROGRESSION_V2_CONFIG_QA_ACCELERATED.motivationalRenewalExtensionDays)
      .toBeLessThan(PROGRESSION_V2_CONFIG.motivationalRenewalExtensionDays);
  });
});
