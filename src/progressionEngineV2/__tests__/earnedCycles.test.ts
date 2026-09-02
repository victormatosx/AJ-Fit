import { describe, expect, it } from 'vitest';
import { countEarnedIntermediateCycles } from '../earnedCycles';

function cycle(overrides: { level: string; status: string; progressionReason: string; cycleNumber?: number; completionReason?: string | null }) {
  return overrides as never;
}

describe('countEarnedIntermediateCycles', () => {
  it('credits the completed starting-Intermediate cycle from its earned successor, not from its entry reason', () => {
    const cycles = [
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'INITIAL_PRESCRIPTION', cycleNumber: 1 } as never),
      cycle({ level: 'INTERMEDIATE', status: 'ACTIVE', progressionReason: 'EARNED_CYCLE_EVOLUTION', cycleNumber: 2 } as never),
    ];
    expect(countEarnedIntermediateCycles(cycles)).toBe(1);
  });

  it('credits a completed legacy Intermediate baseline once its first V2-earned successor exists', () => {
    const cycles = [
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'V1_MIGRATION_BASELINE_NO_PRIOR_HISTORY_INFERRED', cycleNumber: 1 } as never),
      cycle({ level: 'INTERMEDIATE', status: 'ACTIVE', progressionReason: 'EARNED_CYCLE_EVOLUTION', cycleNumber: 2 } as never),
    ];
    expect(countEarnedIntermediateCycles(cycles)).toBe(1);
  });

  it('counts only COMPLETED INTERMEDIATE cycles with an explicit earned completion reason', () => {
    const cycles = [
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'INITIAL_PRESCRIPTION', completionReason: 'EARNED_EVOLUTION' }),
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'EARNED_CYCLE_EVOLUTION', completionReason: 'EARNED_EVOLUTION' }),
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'EARNED_CYCLE_EVOLUTION', completionReason: 'EARNED_EVOLUTION' }),
    ];
    expect(countEarnedIntermediateCycles(cycles)).toBe(3);
  });

  it('excludes motivational renewals', () => {
    const cycles = [
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'INITIAL_PRESCRIPTION', completionReason: 'EARNED_EVOLUTION' }),
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'MOTIVATIONAL_RENEWAL' }),
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'MOTIVATIONAL_RENEWAL' }),
    ];
    expect(countEarnedIntermediateCycles(cycles)).toBe(1);
  });

  it('excludes program adaptations', () => {
    const cycles = [
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'INITIAL_PRESCRIPTION', completionReason: 'EARNED_EVOLUTION' }),
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'PROGRAM_ADAPTATION' }),
    ];
    expect(countEarnedIntermediateCycles(cycles)).toBe(1);
  });

  it('excludes the V1 migration baseline (never invents history)', () => {
    const cycles = [
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'V1_MIGRATION_BASELINE_NO_PRIOR_HISTORY_INFERRED' }),
    ];
    expect(countEarnedIntermediateCycles(cycles)).toBe(0);
  });

  it('excludes non-INTERMEDIATE levels and non-COMPLETED status', () => {
    const cycles = [
      cycle({ level: 'BEGINNER', status: 'COMPLETED', progressionReason: 'EARNED_LEVEL_PROMOTION' }),
      cycle({ level: 'ADVANCED', status: 'COMPLETED', progressionReason: 'EARNED_CYCLE_EVOLUTION' }),
      cycle({ level: 'INTERMEDIATE', status: 'ACTIVE', progressionReason: 'EARNED_CYCLE_EVOLUTION' }),
    ];
    expect(countEarnedIntermediateCycles(cycles)).toBe(0);
  });
});
