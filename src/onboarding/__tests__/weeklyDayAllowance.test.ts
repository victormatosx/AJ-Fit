import { describe, expect, it } from 'vitest';
import type { Quiz } from '../../state/AppState';
import { isBeginnerExperience } from '../../workoutPrescription/personalization';
import type { QuestionnaireAnswers } from '../../workoutPrescription/types';
import {
  BEGINNER_MAX_WEEKLY_DAYS,
  isBeginnerLevelSelection,
  MIN_WEEKLY_DAYS,
  STANDARD_MAX_WEEKLY_DAYS,
  maxWeeklyDaysForLevel,
  maxWeeklyDaysForTrainingLevel,
} from '../weeklyDayAllowance';
import { AVAILABLE_FREQUENCIES, availableFrequenciesForLevel } from '../weeklyScheduleSelection';

/** Every value `Quiz['level']` can hold: current, deprecated and legacy. */
const ALL_QUIZ_LEVELS: Quiz['level'][] = [
  'beginner', 'intermediate', 'intermediate_experienced', 'advanced',
  'never_or_starting', 'beg', 'int', 'adv', 'elite', null,
];

describe('weekly day allowance — the definitive policy', () => {
  it('is 2-3 for beginners', () => {
    expect(MIN_WEEKLY_DAYS).toBe(2);
    expect(BEGINNER_MAX_WEEKLY_DAYS).toBe(3);
    expect(maxWeeklyDaysForLevel('beginner')).toBe(3);
    expect(maxWeeklyDaysForTrainingLevel('BEGINNER')).toBe(3);
  });

  it.each(['intermediate', 'intermediate_experienced', 'advanced'] as const)(
    'is 2-6 for %s', (level) => {
      expect(STANDARD_MAX_WEEKLY_DAYS).toBe(6);
      expect(maxWeeklyDaysForLevel(level)).toBe(6);
      expect(availableFrequenciesForLevel(level)).toEqual([2, 3, 4, 5, 6]);
    },
  );

  it.each(['INTERMEDIATE', 'ADVANCED'] as const)('is 2-6 for lifecycle level %s', (level) => {
    expect(maxWeeklyDaysForTrainingLevel(level)).toBe(6);
  });

  it('offers beginners only 2 and 3', () => {
    expect(availableFrequenciesForLevel('beginner')).toEqual([2, 3]);
  });

  it('never offers 7 to anyone', () => {
    expect(AVAILABLE_FREQUENCIES).not.toContain(7);
    for (const level of ALL_QUIZ_LEVELS) {
      expect(maxWeeklyDaysForLevel(level)).toBeLessThanOrEqual(6);
      expect(availableFrequenciesForLevel(level)).not.toContain(7);
    }
    for (const level of ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const) {
      expect(maxWeeklyDaysForTrainingLevel(level)).toBeLessThanOrEqual(6);
    }
    expect(maxWeeklyDaysForTrainingLevel(null)).toBeLessThanOrEqual(6);
  });

  it('never offers fewer than two days to anyone', () => {
    expect(Math.min(...AVAILABLE_FREQUENCIES)).toBe(MIN_WEEKLY_DAYS);
    for (const level of ALL_QUIZ_LEVELS) {
      expect(Math.min(...availableFrequenciesForLevel(level))).toBe(MIN_WEEKLY_DAYS);
    }
  });

  it('falls back to the standard ceiling, not the beginner one, for an unknown level', () => {
    // An unanswered questionnaire or a not-yet-loaded lifecycle must not
    // tighten anything below what the account may be entitled to.
    expect(maxWeeklyDaysForLevel(null)).toBe(STANDARD_MAX_WEEKLY_DAYS);
    expect(maxWeeklyDaysForTrainingLevel(null)).toBe(STANDARD_MAX_WEEKLY_DAYS);
    expect(maxWeeklyDaysForTrainingLevel(undefined)).toBe(STANDARD_MAX_WEEKLY_DAYS);
  });

  /**
   * Drift guard: `weeklyDayAllowance` re-states the engine's beginner test
   * instead of importing it (import cycle — see that module's doc comment),
   * so the two must be proven equivalent for every level value.
   */
  it.each(ALL_QUIZ_LEVELS)('agrees with the engine beginner route for level %s', (level) => {
    expect(isBeginnerLevelSelection(level)).toBe(
      isBeginnerExperience({ level } as QuestionnaireAnswers),
    );
  });
});
