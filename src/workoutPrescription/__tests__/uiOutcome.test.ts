import { describe, expect, it } from 'vitest';

import {
  canRetryGeneration,
  onboardingGenerationFailurePresentation,
  prescriptionOutcomeKey,
} from '../uiOutcome';

describe('controlled prescription UI outcomes', () => {
  it('renders NO_EXECUTABLE_SESSION safely without offering a blind retry', () => {
    expect(prescriptionOutcomeKey('NO_EXECUTABLE_SESSION')).toBe('unavailable');
    expect(canRetryGeneration('NO_EXECUTABLE_SESSION')).toBe(false);
  });

  it('presents professional restriction as a reviewable safety outcome, never a retryable technical error', () => {
    expect(onboardingGenerationFailurePresentation('REQUIRES_CLEARANCE')).toEqual({
      outcomeKey: 'requiresClearance',
      action: 'reviewAnswers',
    });
  });
});
