import { describe, expect, it } from 'vitest';
import { deriveTrainingDaySlots } from '../planDerivation';

describe('deriveTrainingDaySlots', () => {
  it.each([2, 3, 4, 5, 6, 7])('returns exactly %d true slots out of 7 for days=%d', (days) => {
    const slots = deriveTrainingDaySlots(days);
    expect(slots).toHaveLength(7);
    expect(slots.filter(Boolean)).toHaveLength(days);
  });

  it('clamps out-of-range input instead of throwing', () => {
    expect(deriveTrainingDaySlots(0).filter(Boolean)).toHaveLength(0);
    expect(deriveTrainingDaySlots(10).filter(Boolean)).toHaveLength(7);
    expect(deriveTrainingDaySlots(-3).filter(Boolean)).toHaveLength(0);
  });

  it('is a pure function of days alone (same input -> same output)', () => {
    expect(deriveTrainingDaySlots(4)).toEqual(deriveTrainingDaySlots(4));
  });

  it('spreads training days evenly rather than clustering them', () => {
    // days=4 across 7 slots should never have a gap of 3+ consecutive rest days.
    const slots = deriveTrainingDaySlots(4);
    let maxGap = 0;
    let gap = 0;
    for (const on of slots) {
      if (!on) {
        gap++;
        maxGap = Math.max(maxGap, gap);
      } else {
        gap = 0;
      }
    }
    expect(maxGap).toBeLessThanOrEqual(2);
  });
});
