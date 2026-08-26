import { describe, expect, it } from 'vitest';
import { LEGACY_REST_SECONDS_FALLBACK, prescribeRestSeconds, REST_SECONDS } from '../restPrescription';

const compound = { mechanic: 'compound' as const, pattern: 'horizontal_push' as const };
const isolation = { mechanic: 'isolation' as const, pattern: 'elbow_flexion' as const };

describe('prescribeRestSeconds — Phase 2, Part B (V1 rest prescription)', () => {
  it('(4) a conventional hypertrophy compound exercise gets the COMPOUND bucket', () => {
    const result = prescribeRestSeconds({ movement: compound, sessionType: 'resistance', reps: '8-12', goalFamily: 'hypertrophy_body_composition' });
    expect(result).toBe(REST_SECONDS.COMPOUND);
    expect(result).toBeGreaterThan(0);
  });

  it('(4) a low-rep compound lift gets the COMPOUND_STRENGTH bucket', () => {
    const result = prescribeRestSeconds({ movement: compound, sessionType: 'strength', reps: '4-6', goalFamily: 'hypertrophy_body_composition' });
    expect(result).toBe(REST_SECONDS.COMPOUND_STRENGTH);
  });

  it('a strength-goal compound lift gets COMPOUND_STRENGTH even at a hypertrophy-typical rep range (goal as the one small adjustment)', () => {
    const result = prescribeRestSeconds({ movement: compound, sessionType: 'strength', reps: '8-10', goalFamily: 'strength' });
    expect(result).toBe(REST_SECONDS.COMPOUND_STRENGTH);
  });

  it('(5) an isolation/accessory exercise gets the ISOLATION bucket', () => {
    const result = prescribeRestSeconds({ movement: isolation, sessionType: 'resistance', reps: '12-15', goalFamily: 'hypertrophy_body_composition' });
    expect(result).toBe(REST_SECONDS.ISOLATION);
    expect(result).toBeGreaterThan(0);
  });

  it('(6) any exercise embedded in a conditioning/circuit session gets CONDITIONING regardless of its own mechanic', () => {
    expect(prescribeRestSeconds({ movement: compound, sessionType: 'circuit' })).toBe(REST_SECONDS.CONDITIONING);
    expect(prescribeRestSeconds({ movement: isolation, sessionType: 'interval' })).toBe(REST_SECONDS.CONDITIONING);
    expect(prescribeRestSeconds({ movement: compound, sessionType: 'cardio' })).toBe(REST_SECONDS.CONDITIONING);
    expect(prescribeRestSeconds({ movement: compound, sessionType: 'mixed' })).toBe(REST_SECONDS.CONDITIONING);
    expect(prescribeRestSeconds({ movement: compound, sessionType: 'balance_cardio' })).toBe(REST_SECONDS.CONDITIONING);
  });

  it('mobility/balance/breathing/gait/cycling patterns deliberately get the explicit "no traditional rest" value, not a silent default', () => {
    for (const pattern of ['mobility', 'balance', 'breathing', 'gait', 'cycling'] as const) {
      expect(prescribeRestSeconds({ movement: { mechanic: 'compound', pattern }, sessionType: 'resistance' })).toBe(
        REST_SECONDS.NO_TRADITIONAL_REST,
      );
    }
  });

  it('(7) every non-"no-rest" category resolves to a strictly positive value', () => {
    expect(REST_SECONDS.COMPOUND_STRENGTH).toBeGreaterThan(0);
    expect(REST_SECONDS.COMPOUND).toBeGreaterThan(0);
    expect(REST_SECONDS.ISOLATION).toBeGreaterThan(0);
    expect(REST_SECONDS.CONDITIONING).toBeGreaterThan(0);
  });

  it('(8) the same input always produces the same restSeconds (deterministic, no randomness/AI)', () => {
    const input = { movement: compound, sessionType: 'resistance', reps: '8-12', goalFamily: 'hypertrophy_body_composition' as const };
    const results = Array.from({ length: 20 }, () => prescribeRestSeconds(input));
    expect(new Set(results).size).toBe(1);
  });

  it('the canonical values match the product spec exactly', () => {
    expect(REST_SECONDS.COMPOUND_STRENGTH).toBe(180);
    expect(REST_SECONDS.COMPOUND).toBe(120);
    expect(REST_SECONDS.ISOLATION).toBe(90);
    expect(REST_SECONDS.CONDITIONING).toBe(60);
  });

  it('legacy fallback is an explicit, documented, non-zero constant — never silently 0', () => {
    expect(LEGACY_REST_SECONDS_FALLBACK).toBe(REST_SECONDS.COMPOUND);
    expect(LEGACY_REST_SECONDS_FALLBACK).toBeGreaterThan(0);
  });
});
