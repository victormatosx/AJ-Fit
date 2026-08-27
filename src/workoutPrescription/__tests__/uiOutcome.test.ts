import { describe, expect, it } from 'vitest';

import { canRetryGeneration, prescriptionOutcomeKey } from '../uiOutcome';

describe('controlled prescription UI outcomes', () => {
  it('renders NO_EXECUTABLE_SESSION safely without offering a blind retry', () => {
    expect(prescriptionOutcomeKey('NO_EXECUTABLE_SESSION')).toBe('unavailable');
    expect(canRetryGeneration('NO_EXECUTABLE_SESSION')).toBe(false);
  });
});
