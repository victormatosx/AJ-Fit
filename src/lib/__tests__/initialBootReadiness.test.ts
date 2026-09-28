import { afterEach, describe, expect, it } from 'vitest';
import {
  hasCompletedInitialBoot,
  markInitialBootCompleted,
  resetInitialBootReadinessForTests,
} from '../initialBootReadiness';

afterEach(() => {
  resetInitialBootReadinessForTests();
});

describe('initialBootReadiness — one-way cold-start latch', () => {
  it('starts false — the process has not presented a first real screen yet', () => {
    expect(hasCompletedInitialBoot()).toBe(false);
  });

  it('flips to true once the first real screen is marked ready', () => {
    markInitialBootCompleted();
    expect(hasCompletedInitialBoot()).toBe(true);
  });

  it('never goes back to false on its own — a later call is a no-op, not a reset', () => {
    markInitialBootCompleted();
    markInitialBootCompleted();
    expect(hasCompletedInitialBoot()).toBe(true);
  });
});
