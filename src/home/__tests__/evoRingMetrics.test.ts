import { describe, expect, it } from 'vitest';
import { requiredActiveDaysForLevel, INTERMEDIATE_CYCLES_FOR_ADVANCED } from '../evoRingMetrics';

describe('requiredActiveDaysForLevel', () => {
  it('returns the beginner minimum for BEGINNER', () => {
    expect(requiredActiveDaysForLevel('BEGINNER')).toBe(28);
  });
  it('returns the intermediate/advanced minimum for INTERMEDIATE and ADVANCED', () => {
    expect(requiredActiveDaysForLevel('INTERMEDIATE')).toBe(85);
    expect(requiredActiveDaysForLevel('ADVANCED')).toBe(85);
  });
});

describe('INTERMEDIATE_CYCLES_FOR_ADVANCED', () => {
  it('matches the engine config constant', () => {
    expect(INTERMEDIATE_CYCLES_FOR_ADVANCED).toBe(4);
  });
});
