import { describe, expect, it } from 'vitest';
import { classifyAdherenceQuality, computeAdherence } from '../adherence';

describe('classifyAdherenceQuality boundaries', () => {
  const cases: Array<[number, 'BELOW_TARGET' | 'GOOD' | 'HIGH']> = [
    [0.69, 'BELOW_TARGET'],
    [0.699, 'BELOW_TARGET'],
    [0.6999, 'BELOW_TARGET'],
    [0.69994, 'BELOW_TARGET'],
    [0.69995, 'BELOW_TARGET'],
    [0.69999, 'BELOW_TARGET'],
    [0.70, 'GOOD'],
    [0.70001, 'GOOD'],
    [0.71, 'GOOD'],
    [0.84, 'GOOD'],
    [0.849, 'GOOD'],
    [0.8499, 'GOOD'],
    [0.84994, 'GOOD'],
    [0.84995, 'GOOD'],
    [0.84999, 'GOOD'],
    [0.85, 'HIGH'],
    [0.85001, 'HIGH'],
    [1.0, 'HIGH'],
  ];
  it.each(cases)('ratio=%s -> %s', (ratio, expected) => {
    expect(classifyAdherenceQuality(ratio)).toBe(expected);
  });
});

describe('computeAdherence', () => {
  it('caps ratio at 1.0 regardless of extra workouts', () => {
    expect(computeAdherence(4, 4).ratio).toBe(1);
    expect(computeAdherence(5, 4).ratio).toBe(1);
    expect(computeAdherence(6, 4).ratio).toBe(1);
    expect(computeAdherence(6, 4).quality).toBe('HIGH');
  });

  it('is zero when there are no expected sessions', () => {
    expect(computeAdherence(0, 0).ratio).toBe(0);
  });

  it('matches 3x/4x/5x weekly examples', () => {
    // 3x/week, 4 valid out of 4 expected over 4 weeks (12 expected) -> below target
    expect(computeAdherence(4, 12).quality).toBe('BELOW_TARGET');
    // 4x/week, 16 expected over 4 weeks, 16 valid -> HIGH (100%)
    expect(computeAdherence(16, 16).quality).toBe('HIGH');
    // 5x/week, 60.71 expected, 43 valid ~ 70.8% -> GOOD
    const adherence = computeAdherence(43, 60.714285714285715);
    expect(adherence.quality).toBe('GOOD');
  });

  it('classifies 34/49 real opportunities as BELOW_TARGET, never the old approximate 70%', () => {
    expect(computeAdherence(34, 49)).toMatchObject({ quality: 'BELOW_TARGET' });
    expect(computeAdherence(34, 49).ratio).toBeCloseTo(0.693877551, 8);
  });
});
