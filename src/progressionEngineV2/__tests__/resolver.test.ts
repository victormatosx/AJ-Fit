import { describe, expect, it } from 'vitest';
import { PROGRESSION_V2_CONFIG, PROGRESSION_V2_CONFIG_QA_ACCELERATED } from '../config';
import { evaluateProgressionV2 } from '../resolver';
import type { ProgressionSnapshotV2 } from '../types';

function snapshot(overrides: Partial<ProgressionSnapshotV2> & { activeDays: number; ratio: number }): ProgressionSnapshotV2 {
  const { activeDays, ratio, ...rest } = overrides;
  return {
    level: 'BEGINNER',
    activeTime: { activeDays, pausedAt: null },
    adherence: { ratio, quality: ratio >= 0.85 ? 'HIGH' : ratio >= 0.7 ? 'GOOD' : 'BELOW_TARGET' },
    earnedIntermediateCycleCount: 0,
    hasInProgressExecution: false,
    validSessionCount: 0,
    ...rest,
  };
}

describe('IN_PROGRESS execution always blocks', () => {
  it('returns NO_ACTION regardless of otherwise-earned state', () => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: 200, ratio: 1, hasInProgressExecution: true }),
    );
    expect(decision).toEqual({ type: 'NO_ACTION', reason: 'IN_PROGRESS_EXECUTION' });
  });
});

describe('Beginner matrix', () => {
  const cases: Array<[number, number, string]> = [
    [27, 1.0, 'PROGRESS_CONTINUES'], // time not reached, even at 100%
    [28, 0.69, 'PROGRESS_CONTINUES'], // adherence not reached
    [28, 0.70, 'LEVEL_PROMOTION_ELIGIBLE'], // exactly the boundary
    [28, 0.85, 'LEVEL_PROMOTION_ELIGIBLE'],
    [40, 0.70, 'LEVEL_PROMOTION_ELIGIBLE'],
  ];
  it.each(cases)('activeDays=%s adherence=%s -> %s', (activeDays, ratio, expectedType) => {
    const decision = evaluateProgressionV2(snapshot({ activeDays, ratio, level: 'BEGINNER' }));
    expect(decision.type).toBe(expectedType);
  });

  it('28 active days + 70% -> GOOD quality; 28 + 85% -> HIGH quality', () => {
    const good = evaluateProgressionV2(snapshot({ activeDays: 28, ratio: 0.70, level: 'BEGINNER' }));
    const high = evaluateProgressionV2(snapshot({ activeDays: 28, ratio: 0.85, level: 'BEGINNER' }));
    expect(good.type).toBe('LEVEL_PROMOTION_ELIGIBLE');
    expect(high.type).toBe('LEVEL_PROMOTION_ELIGIBLE');
    if (good.type === 'LEVEL_PROMOTION_ELIGIBLE') expect(good.quality).toBe('GOOD');
    if (high.type === 'LEVEL_PROMOTION_ELIGIBLE') expect(high.quality).toBe('HIGH');
  });

  it('Beginner eligible decision names the BEGINNER -> INTERMEDIATE transition, never a bare cycle rotation', () => {
    const decision = evaluateProgressionV2(snapshot({ activeDays: 28, ratio: 0.70, level: 'BEGINNER' }));
    expect(decision).toMatchObject({ type: 'LEVEL_PROMOTION_ELIGIBLE', from: 'BEGINNER', to: 'INTERMEDIATE' });
  });

  it('training a lot in fewer days does not substitute for elapsed active time (20 active days, adherence capped at 100%)', () => {
    // Extra workouts can push validSessionCount arbitrarily high, but adherence
    // is capped at 1.0 by computeAdherence upstream — the snapshot here models
    // that already-capped input; activeDays independently still gates.
    const decision = evaluateProgressionV2(snapshot({ activeDays: 20, ratio: 1.0, level: 'BEGINNER' }));
    expect(decision.type).toBe('PROGRESS_CONTINUES');
  });
});

describe('Intermediate matrix', () => {
  const cases: Array<[number, number, string]> = [
    [84, 1.0, 'PROGRESS_CONTINUES'],
    [85, 0.69, 'PROGRESS_CONTINUES'],
    [85, 0.70, 'EVOLUTION_ELIGIBLE'],
    [85, 0.85, 'EVOLUTION_ELIGIBLE'],
    [100, 0.70, 'EVOLUTION_ELIGIBLE'],
  ];
  it.each(cases)('activeDays=%s adherence=%s -> %s', (activeDays, ratio, expectedType) => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays, ratio, level: 'INTERMEDIATE', earnedIntermediateCycleCount: 0 }),
    );
    expect(decision.type).toBe(expectedType);
  });

  it('85 + 70% is GOOD quality cycle evolution; 85 + 85% is HIGH', () => {
    const good = evaluateProgressionV2(snapshot({ activeDays: 85, ratio: 0.70, level: 'INTERMEDIATE' }));
    const high = evaluateProgressionV2(snapshot({ activeDays: 85, ratio: 0.85, level: 'INTERMEDIATE' }));
    expect(good).toMatchObject({ type: 'EVOLUTION_ELIGIBLE', level: 'INTERMEDIATE', quality: 'GOOD' });
    expect(high).toMatchObject({ type: 'EVOLUTION_ELIGIBLE', level: 'INTERMEDIATE', quality: 'HIGH' });
  });
});

describe('exact adherence decision boundaries', () => {
  it.each([0.699, 0.6999, 0.69995, 0.69999])(
    'ratio %s remains below the 70%% earned gate without display rounding leakage',
    (ratio) => {
      expect(evaluateProgressionV2(snapshot({ activeDays: 85, ratio, level: 'INTERMEDIATE' })).type)
        .toBe('PROGRESS_CONTINUES');
    },
  );

  it('exactly 70% is earned, while exactly 85% is HIGH and values immediately below remain GOOD', () => {
    expect(evaluateProgressionV2(snapshot({ activeDays: 85, ratio: 0.7, level: 'INTERMEDIATE' })))
      .toMatchObject({ type: 'EVOLUTION_ELIGIBLE', quality: 'GOOD' });
    expect(evaluateProgressionV2(snapshot({ activeDays: 85, ratio: 0.84999, level: 'INTERMEDIATE' })))
      .toMatchObject({ type: 'EVOLUTION_ELIGIBLE', quality: 'GOOD' });
    expect(evaluateProgressionV2(snapshot({ activeDays: 85, ratio: 0.85, level: 'INTERMEDIATE' })))
      .toMatchObject({ type: 'EVOLUTION_ELIGIBLE', quality: 'HIGH' });
  });
});

describe('Advanced never promotes to a nonexistent level', () => {
  const cycleCounts = [0, 1, 4, 20, 100];
  it.each(cycleCounts)('earnedIntermediateCycleCount=%s (irrelevant for Advanced) -> EVOLUTION_ELIGIBLE, never LEVEL_PROMOTION_ELIGIBLE', (count) => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: 85, ratio: 0.70, level: 'ADVANCED', earnedIntermediateCycleCount: count }),
    );
    expect(decision).toMatchObject({ type: 'EVOLUTION_ELIGIBLE', level: 'ADVANCED' });
  });
});

describe('Intermediate -> Advanced: exactly 4 earned cycles required', () => {
  it.each([0, 1, 2])('earnedIntermediateCycleCount=%s -> stays EVOLUTION_ELIGIBLE (no promotion)', (count) => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: 85, ratio: 0.70, level: 'INTERMEDIATE', earnedIntermediateCycleCount: count }),
    );
    expect(decision).toMatchObject({ type: 'EVOLUTION_ELIGIBLE', level: 'INTERMEDIATE' });
  });

  it('the 4th earned cycle (earnedIntermediateCycleCount=3, this one about to complete) -> LEVEL_PROMOTION_ELIGIBLE to ADVANCED', () => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: 85, ratio: 0.70, level: 'INTERMEDIATE', earnedIntermediateCycleCount: 3 }),
    );
    expect(decision).toMatchObject({ type: 'LEVEL_PROMOTION_ELIGIBLE', from: 'INTERMEDIATE', to: 'ADVANCED' });
  });

  it('motivational renewals and program adaptations never count toward the 4 (caller-level guarantee — snapshot only trusts the count it is given)', () => {
    // Given a caller that correctly excludes renewals/adaptations, 3 earned +
    // this cycle still requires meeting the earned bar itself.
    const belowBar = evaluateProgressionV2(
      snapshot({ activeDays: 85, ratio: 0.5, level: 'INTERMEDIATE', earnedIntermediateCycleCount: 3 }),
    );
    expect(belowBar.type).not.toBe('LEVEL_PROMOTION_ELIGIBLE');
  });
});

describe('Motivational Renewal', () => {
  const extension = PROGRESSION_V2_CONFIG.motivationalRenewalExtensionDays;
  const beginnerMin = PROGRESSION_V2_CONFIG.beginnerMinimumActiveDays;

  it('low adherence within the normal window just continues, no renewal yet', () => {
    const decision = evaluateProgressionV2(snapshot({ activeDays: beginnerMin, ratio: 0.2, level: 'BEGINNER' }));
    expect(decision.type).toBe('PROGRESS_CONTINUES');
  });

  it('extension not yet reached still continues', () => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: beginnerMin + extension - 1, ratio: 0.2, level: 'BEGINNER' }),
    );
    expect(decision.type).toBe('PROGRESS_CONTINUES');
  });

  it('extension reached with adherence still below threshold -> MOTIVATIONAL_RENEWAL_AVAILABLE', () => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: beginnerMin + extension, ratio: 0.2, level: 'BEGINNER' }),
    );
    expect(decision.type).toBe('MOTIVATIONAL_RENEWAL_AVAILABLE');
  });

  it('extension reached but adherence now clears the earned bar -> earned evolution takes precedence, never renewal', () => {
    const atThreshold = evaluateProgressionV2(
      snapshot({ activeDays: beginnerMin + extension, ratio: 0.70, level: 'BEGINNER' }),
    );
    expect(atThreshold.type).toBe('LEVEL_PROMOTION_ELIGIBLE');
    const high = evaluateProgressionV2(
      snapshot({ activeDays: beginnerMin + extension, ratio: 0.85, level: 'BEGINNER' }),
    );
    expect(high).toMatchObject({ type: 'LEVEL_PROMOTION_ELIGIBLE', quality: 'HIGH' });
  });

  it('never returns EVOLUTION_ELIGIBLE/LEVEL_PROMOTION_ELIGIBLE and MOTIVATIONAL_RENEWAL_AVAILABLE simultaneously (single discriminant by construction)', () => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: beginnerMin + extension, ratio: 0.2, level: 'BEGINNER' }),
    );
    expect(decision.type).toBe('MOTIVATIONAL_RENEWAL_AVAILABLE');
    expect(decision.type).not.toBe('EVOLUTION_ELIGIBLE');
    expect(decision.type).not.toBe('LEVEL_PROMOTION_ELIGIBLE');
  });

  it('Motivational Renewal reason is distinct telemetry, never claims an earned reason', () => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: beginnerMin + extension, ratio: 0.2, level: 'BEGINNER' }),
    );
    expect(decision).toMatchObject({ reason: 'MOTIVATIONAL_EXTENSION_REACHED' });
  });
});

describe('Idempotency', () => {
  it('evaluating the exact same snapshot twice returns the exact same decision', () => {
    const input = snapshot({ activeDays: 85, ratio: 0.7, level: 'INTERMEDIATE', earnedIntermediateCycleCount: 3 });
    const first = evaluateProgressionV2(input);
    const second = evaluateProgressionV2(input);
    expect(first).toEqual(second);
  });
});

describe('QA_ACCELERATED policy — DEV Accelerated Lifecycle QA', () => {
  const qa = PROGRESSION_V2_CONFIG_QA_ACCELERATED;

  it('NORMAL config passed explicitly behaves exactly like the default (no drift introduced by threading config through)', () => {
    const input = snapshot({ activeDays: 28, ratio: 0.7, level: 'BEGINNER' });
    expect(evaluateProgressionV2(input, PROGRESSION_V2_CONFIG)).toEqual(evaluateProgressionV2(input));
  });

  it('QA does not evolve a Beginner before the QA minimum, even with perfect adherence', () => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: qa.beginnerMinimumActiveDays - 1, ratio: 1.0, level: 'BEGINNER' }), qa,
    );
    expect(decision.type).toBe('PROGRESS_CONTINUES');
  });

  it('QA evolves a Beginner exactly at the QA minimum + earned adherence', () => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: qa.beginnerMinimumActiveDays, ratio: 0.70, level: 'BEGINNER' }), qa,
    );
    expect(decision).toMatchObject({ type: 'LEVEL_PROMOTION_ELIGIBLE', from: 'BEGINNER', to: 'INTERMEDIATE', quality: 'GOOD' });
  });

  it('QA still enforces the unchanged 70%/85% adherence boundaries (only the day-count shrank)', () => {
    const insufficient = evaluateProgressionV2(
      snapshot({ activeDays: qa.beginnerMinimumActiveDays, ratio: 0.699, level: 'BEGINNER' }), qa,
    );
    expect(insufficient.type).toBe('PROGRESS_CONTINUES');
    const high = evaluateProgressionV2(
      snapshot({ activeDays: qa.beginnerMinimumActiveDays, ratio: 0.85, level: 'BEGINNER' }), qa,
    );
    expect(high).toMatchObject({ type: 'LEVEL_PROMOTION_ELIGIBLE', quality: 'HIGH' });
  });

  it('QA does not evolve Intermediate/Advanced before the QA minimum', () => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: qa.intermediateAdvancedMinimumActiveDays - 1, ratio: 1.0, level: 'INTERMEDIATE' }), qa,
    );
    expect(decision.type).toBe('PROGRESS_CONTINUES');
  });

  it('QA still requires all 4 earned Intermediate cycles for Advanced — never fewer', () => {
    const threeEarned = evaluateProgressionV2(
      snapshot({
        activeDays: qa.intermediateAdvancedMinimumActiveDays, ratio: 0.70, level: 'INTERMEDIATE',
        earnedIntermediateCycleCount: 2,
      }), qa,
    );
    expect(threeEarned).toMatchObject({ type: 'EVOLUTION_ELIGIBLE' });

    const fourEarned = evaluateProgressionV2(
      snapshot({
        activeDays: qa.intermediateAdvancedMinimumActiveDays, ratio: 0.70, level: 'INTERMEDIATE',
        earnedIntermediateCycleCount: 3,
      }), qa,
    );
    expect(fourEarned).toMatchObject({ type: 'LEVEL_PROMOTION_ELIGIBLE', from: 'INTERMEDIATE', to: 'ADVANCED' });
  });

  it('QA offers Motivational Renewal only after the QA-compressed extension, never before', () => {
    const beforeExtension = evaluateProgressionV2(
      snapshot({
        activeDays: qa.beginnerMinimumActiveDays + qa.motivationalRenewalExtensionDays - 1,
        ratio: 0.2, level: 'BEGINNER',
      }), qa,
    );
    expect(beforeExtension.type).toBe('PROGRESS_CONTINUES');

    const atExtension = evaluateProgressionV2(
      snapshot({
        activeDays: qa.beginnerMinimumActiveDays + qa.motivationalRenewalExtensionDays,
        ratio: 0.2, level: 'BEGINNER',
      }), qa,
    );
    expect(atExtension.type).toBe('MOTIVATIONAL_RENEWAL_AVAILABLE');
  });

  it('extra workouts still cannot substitute for QA active-day accrual (adherence caps at 100%, day-count independently gates)', () => {
    const decision = evaluateProgressionV2(
      snapshot({ activeDays: qa.beginnerMinimumActiveDays - 1, ratio: 1.0, level: 'BEGINNER', validSessionCount: 999 }), qa,
    );
    expect(decision.type).toBe('PROGRESS_CONTINUES');
  });
});
