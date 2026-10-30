import { describe, expect, it } from 'vitest';
import {
  BEGINNER_MAX_WEEKLY_DAYS_SERVER,
  MIN_WEEKLY_DAYS_SERVER,
  STANDARD_MAX_WEEKLY_DAYS_SERVER,
  maxWeeklyDaysForTrainingLevelServer,
} from '../../../functions/src/workoutLifecycle/authorizeMutation';
import type { CurrentTrainingLevel } from '../../workoutLifecycle/types';
import {
  BEGINNER_MAX_WEEKLY_DAYS,
  MIN_WEEKLY_DAYS,
  STANDARD_MAX_WEEKLY_DAYS,
  maxWeeklyDaysForTrainingLevel,
} from '../weeklyDayAllowance';

const LEVELS: CurrentTrainingLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

/**
 * The bounds are enforced in two places that cannot import each other (the
 * Cloud Function is outside the mirrored prescription-engine tree). If they
 * ever disagree, the UI offers a frequency the authority refuses — or the
 * authority accepts one the UI forbids. This test keeps them honest.
 */
describe('weekly day bounds — client/server parity', () => {
  it('agrees on the beginner ceiling', () => {
    expect(BEGINNER_MAX_WEEKLY_DAYS_SERVER).toBe(BEGINNER_MAX_WEEKLY_DAYS);
  });

  it('agrees on the standard ceiling', () => {
    expect(STANDARD_MAX_WEEKLY_DAYS_SERVER).toBe(STANDARD_MAX_WEEKLY_DAYS);
  });

  it('agrees on the floor', () => {
    expect(MIN_WEEKLY_DAYS_SERVER).toBe(MIN_WEEKLY_DAYS);
  });

  it.each(LEVELS)('agrees for lifecycle level %s', (level) => {
    expect(maxWeeklyDaysForTrainingLevelServer(level)).toBe(maxWeeklyDaysForTrainingLevel(level));
  });

  it('neither side allows 7 for any level', () => {
    for (const level of LEVELS) {
      expect(maxWeeklyDaysForTrainingLevelServer(level)).toBeLessThanOrEqual(6);
    }
  });
});
