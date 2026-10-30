import { describe, expect, it } from 'vitest';
import { adherenceBasisPoints, classifyAdherenceQuality, computeAdherence } from '../adherence';

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
    // `ratio` is the basis-point figure divided by 10000 — the same integer
    // the ledger records — so it is quantized to 4 decimals BY DESIGN:
    // floor(34 * 10000 / 49) = 6938.
    expect(computeAdherence(34, 49).ratio).toBe(0.6938);
  });
});

/**
 * REGRESSION — client/authority basis-point parity.
 *
 * The audit proved that the client transported `Math.round(ratio * 10000)`
 * from a float division while the authority computed
 * `Math.floor(valid * 10000 / expected)` from integers. They differ by 1 bp
 * on 47.9% of all `(valid, expected)` pairs at or above the earning
 * threshold, and the authority's canonical comparison then rejected the EARN
 * as forged — a hard block on evolution. These tests fail if either rounding
 * mode or either formula is ever reintroduced.
 */
describe('adherenceBasisPoints — the one definition both sides use', () => {
  it('truncates toward zero and never rounds up', () => {
    // The exact pairs the audit enumerated as the smallest divergences.
    expect(adherenceBasisPoints(5, 7)).toBe(7142);     // round() would give 7143
    expect(adherenceBasisPoints(7, 9)).toBe(7777);     // round() would give 7778
    expect(adherenceBasisPoints(8, 9)).toBe(8888);     // round() would give 8889
    expect(adherenceBasisPoints(8, 11)).toBe(7272);    // round() would give 7273
    expect(adherenceBasisPoints(11, 12)).toBe(9166);   // round() would give 9167
    expect(adherenceBasisPoints(24, 31)).toBe(7741);   // round() would give 7742
  });

  it('never disagrees with the float formula the client used to transport', () => {
    // Exhaustive over every realistic denominator: the ONE function must be
    // the only source, so `ratio` and the transported integer agree by
    // construction for every pair.
    for (let expected = 1; expected <= 400; expected += 1) {
      for (let valid = 0; valid <= expected; valid += 1) {
        const bp = adherenceBasisPoints(valid, expected);
        expect(computeAdherence(valid, expected).ratio, `${valid}/${expected}`).toBe(bp / 10_000);
      }
    }
  });

  it('stays inside 0..10000 and treats degenerate input as zero', () => {
    expect(adherenceBasisPoints(0, 10)).toBe(0);
    expect(adherenceBasisPoints(10, 10)).toBe(10_000);
    expect(adherenceBasisPoints(99, 10)).toBe(10_000);     // extras never exceed 100%
    expect(adherenceBasisPoints(-5, 10)).toBe(0);
    expect(adherenceBasisPoints(5, 0)).toBe(0);
    expect(adherenceBasisPoints(5, -1)).toBe(0);
    expect(adherenceBasisPoints(Number.NaN, 10)).toBe(0);
    expect(adherenceBasisPoints(5, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('preserves the 70% and 85% boundaries exactly', () => {
    expect(adherenceBasisPoints(7, 10)).toBe(7000);
    expect(computeAdherence(7, 10).quality).toBe('GOOD');
    expect(adherenceBasisPoints(699, 1000)).toBe(6990);
    expect(computeAdherence(699, 1000).quality).toBe('BELOW_TARGET');
    expect(adherenceBasisPoints(85, 100)).toBe(8500);
    expect(computeAdherence(85, 100).quality).toBe('HIGH');
    expect(adherenceBasisPoints(8499, 10000)).toBe(8499);
    expect(computeAdherence(8499, 10000).quality).toBe('GOOD');
  });

  it('makes the evaluator gate algebraically identical to the quality band', () => {
    // `ratio >= 0.70` must hold exactly when `valid * 10000 >= 7000 * expected`
    // — the cross-multiplication the quality classifier uses. Any drift
    // between the two reopens the possibility of an "earned" decision whose
    // quality says BELOW_TARGET, or the reverse.
    for (let expected = 1; expected <= 200; expected += 1) {
      for (let valid = 0; valid <= expected; valid += 1) {
        const gate = computeAdherence(valid, expected).ratio >= 0.7;
        const band = computeAdherence(valid, expected).quality !== 'BELOW_TARGET';
        expect(gate, `${valid}/${expected}`).toBe(band);
      }
    }
  });
});
