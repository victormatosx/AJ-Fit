import { describe, expect, it } from 'vitest';
import { PROGRESSION_V2_CONFIG } from '../config';
import { countEarnedIntermediateCycles } from '../earnedCycles';

type CycleFixtureInput = {
  level: any;
  status: any;
  progressionReason: any;
  cycleNumber?: number;
  completionReason?: any;
};

type CycleFixture = Omit<CycleFixtureInput, 'cycleNumber'> & { cycleNumber: number };

function cycle(overrides: CycleFixtureInput): CycleFixture {
  return { ...overrides, cycleNumber: overrides.cycleNumber ?? 1 };
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

type TestCycle = ReturnType<typeof cycle>;

function fullScanDecision(level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED', cycles: TestCycle[]) {
  if (level === 'BEGINNER') return 'LEVEL_PROMOTION';
  if (level === 'ADVANCED') return 'CYCLE_EVOLUTION';
  return countEarnedIntermediateCycles(cycles) + 1 >= PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion
    ? 'LEVEL_PROMOTION'
    : 'CYCLE_EVOLUTION';
}

function boundedDecision(level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED', cycles: TestCycle[]) {
  const bounded = level === 'INTERMEDIATE'
    ? cycles
      .filter((item) => item.level === 'INTERMEDIATE')
      .sort((left, right) => (right.cycleNumber ?? 0) - (left.cycleNumber ?? 0))
      .slice(0, PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion)
    : [];
  return fullScanDecision(level, bounded);
}

describe('bounded Intermediate promotion history — full-scan oracle equivalence', () => {
  const earned = (cycleNumber: number, status = 'COMPLETED') => cycle({
    level: 'INTERMEDIATE', status, progressionReason: cycleNumber === 1 ? 'INITIAL_PRESCRIPTION' : 'EARNED_CYCLE_EVOLUTION',
    cycleNumber, completionReason: status === 'COMPLETED' ? 'EARNED_EVOLUTION' : null,
  });

  it.each([
    ['BEGINNER initial', 'BEGINNER', [cycle({ level: 'BEGINNER', status: 'ACTIVE', progressionReason: 'INITIAL_PRESCRIPTION', cycleNumber: 1 })]],
    ['BEGINNER to INTERMEDIATE boundary', 'BEGINNER', [cycle({ level: 'INTERMEDIATE', status: 'ACTIVE', progressionReason: 'EARNED_LEVEL_PROMOTION', cycleNumber: 1 })]],
    ['INTERMEDIATE cycle 1', 'INTERMEDIATE', [earned(1, 'ACTIVE')]],
    ['INTERMEDIATE cycle 2', 'INTERMEDIATE', [earned(1), earned(2, 'ACTIVE')]],
    ['INTERMEDIATE cycle 3', 'INTERMEDIATE', [earned(1), earned(2), earned(3, 'ACTIVE')]],
    ['INTERMEDIATE promotion boundary', 'INTERMEDIATE', [earned(1), earned(2), earned(3), earned(4, 'ACTIVE')]],
    ['ADVANCED', 'ADVANCED', [earned(1), earned(2), earned(3), earned(4)]],
  ] as const)('%s: old/full and new/bounded decisions match', (_name, level, cycles) => {
    expect(boundedDecision(level, [...cycles])).toBe(fullScanDecision(level, [...cycles]));
  });

  it('keeps the active successor required by legacy pre-8A inference at the promotion boundary', () => {
    const cycles = [1, 2, 3].map((cycleNumber) => cycle({
      level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: cycleNumber === 1 ? 'INITIAL_PRESCRIPTION' : 'EARNED_CYCLE_EVOLUTION', cycleNumber,
    }));
    cycles.push(cycle({ level: 'INTERMEDIATE', status: 'ACTIVE', progressionReason: 'EARNED_CYCLE_EVOLUTION', cycleNumber: 4 }));
    expect(fullScanDecision('INTERMEDIATE', cycles)).toBe('LEVEL_PROMOTION');
    expect(boundedDecision('INTERMEDIATE', cycles)).toBe('LEVEL_PROMOTION');
  });

  it('ignores a 120-document history outside the relevant level/window without changing the authoritative branch', () => {
    const irrelevant = Array.from({ length: 120 }, (_, index) => cycle({
      level: index % 2 === 0 ? 'BEGINNER' : 'ADVANCED', status: 'COMPLETED',
      progressionReason: 'EARNED_CYCLE_EVOLUTION', cycleNumber: index + 100,
      completionReason: 'EARNED_EVOLUTION',
    }));
    const cycles = [...irrelevant, earned(1), earned(2), earned(3), earned(4, 'ACTIVE')];
    expect(boundedDecision('INTERMEDIATE', cycles)).toBe(fullScanDecision('INTERMEDIATE', cycles));
  });

  it('is stable across retries and does not credit incomplete or explicitly non-earned legacy data', () => {
    const cycles = [
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'INITIAL_PRESCRIPTION', cycleNumber: 1, completionReason: 'EARNED_EVOLUTION' }),
      cycle({ level: 'INTERMEDIATE', status: 'ACTIVE', progressionReason: 'EARNED_CYCLE_EVOLUTION', cycleNumber: 2 }),
      cycle({ level: 'INTERMEDIATE', status: 'COMPLETED', progressionReason: 'PROGRAM_ADAPTATION', cycleNumber: -10, completionReason: 'OTHER' }),
    ];
    const first = boundedDecision('INTERMEDIATE', [...cycles]);
    const retry = boundedDecision('INTERMEDIATE', [...cycles]);
    expect(retry).toBe(first);
    expect(first).toBe(fullScanDecision('INTERMEDIATE', cycles));
  });
});
