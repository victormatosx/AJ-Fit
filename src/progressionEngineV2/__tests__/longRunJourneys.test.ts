import { describe, expect, it } from 'vitest';

import { countEarnedIntermediateCycles } from '../earnedCycles';
import { evaluateProgressionV2 } from '../resolver';
import type { ProgressionSnapshotV2 } from '../types';

function earnedSnapshot(
  level: ProgressionSnapshotV2['level'],
  earnedIntermediateCycleCount: number,
): ProgressionSnapshotV2 {
  return {
    level,
    activeTime: { activeDays: level === 'BEGINNER' ? 28 : 85, pausedAt: null },
    adherence: { ratio: 0.85, quality: 'HIGH' },
    earnedIntermediateCycleCount,
    hasInProgressExecution: false,
    validSessionCount: 40,
  };
}

describe('long-run lifecycle journeys', () => {
  it('runs Beginner → four earned Intermediate cycles → Advanced and three unbounded Advanced cycles without duplication', () => {
    const decisions = [];
    const beginner = evaluateProgressionV2(earnedSnapshot('BEGINNER', 0));
    decisions.push(beginner.type);
    expect(beginner).toMatchObject({
      type: 'LEVEL_PROMOTION_ELIGIBLE', from: 'BEGINNER', to: 'INTERMEDIATE',
    });

    const intermediateCycles: Array<{
      level: 'INTERMEDIATE'; status: 'COMPLETED'; cycleNumber: number;
      progressionReason: 'EARNED_CYCLE_EVOLUTION' | 'EARNED_LEVEL_PROMOTION';
      completionReason: 'EARNED_EVOLUTION';
    }> = [];
    for (let cycleNumber = 1; cycleNumber <= 4; cycleNumber += 1) {
      const earnedBefore = countEarnedIntermediateCycles(intermediateCycles);
      const first = evaluateProgressionV2(earnedSnapshot('INTERMEDIATE', earnedBefore));
      const retry = evaluateProgressionV2(earnedSnapshot('INTERMEDIATE', earnedBefore));
      expect(retry).toEqual(first);
      expect(first.type).toBe(cycleNumber === 4 ? 'LEVEL_PROMOTION_ELIGIBLE' : 'EVOLUTION_ELIGIBLE');
      decisions.push(first.type);
      intermediateCycles.push({
        level: 'INTERMEDIATE', status: 'COMPLETED', cycleNumber,
        progressionReason: cycleNumber === 4 ? 'EARNED_LEVEL_PROMOTION' : 'EARNED_CYCLE_EVOLUTION',
        completionReason: 'EARNED_EVOLUTION',
      });
    }
    expect(countEarnedIntermediateCycles(intermediateCycles)).toBe(4);

    const advancedCycleNumbers: number[] = [];
    for (let cycleNumber = 1; cycleNumber <= 3; cycleNumber += 1) {
      const decision = evaluateProgressionV2(earnedSnapshot('ADVANCED', 4));
      expect(decision).toMatchObject({ type: 'EVOLUTION_ELIGIBLE', level: 'ADVANCED' });
      advancedCycleNumbers.push(cycleNumber);
      decisions.push(decision.type);
    }
    expect(advancedCycleNumbers).toEqual([1, 2, 3]);
    expect(decisions).toEqual([
      'LEVEL_PROMOTION_ELIGIBLE',
      'EVOLUTION_ELIGIBLE', 'EVOLUTION_ELIGIBLE', 'EVOLUTION_ELIGIBLE',
      'LEVEL_PROMOTION_ELIGIBLE',
      'EVOLUTION_ELIGIBLE', 'EVOLUTION_ELIGIBLE', 'EVOLUTION_ELIGIBLE',
    ]);
  });

  it('keeps low-adherence renewals out of earned Intermediate credit until a later real earned cycle', () => {
    const lowAdherence: ProgressionSnapshotV2 = {
      ...earnedSnapshot('INTERMEDIATE', 2),
      activeTime: { activeDays: 115, pausedAt: null },
      adherence: { ratio: 0.4, quality: 'BELOW_TARGET' },
    };
    expect(evaluateProgressionV2(lowAdherence).type).toBe('MOTIVATIONAL_RENEWAL_AVAILABLE');
    expect(evaluateProgressionV2(lowAdherence).type).toBe('MOTIVATIONAL_RENEWAL_AVAILABLE');
    expect(countEarnedIntermediateCycles([
      {
        level: 'INTERMEDIATE', status: 'ACTIVE', cycleNumber: 3,
        progressionReason: 'MOTIVATIONAL_RENEWAL', completionReason: null,
      },
    ])).toBe(0);
    expect(evaluateProgressionV2(earnedSnapshot('INTERMEDIATE', 2)))
      .toMatchObject({ type: 'EVOLUTION_ELIGIBLE' });
  });
});
