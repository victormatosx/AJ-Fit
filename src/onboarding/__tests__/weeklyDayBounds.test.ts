import { describe, expect, it } from 'vitest';
import { cleanApplicableAnswers, normalizeLoadedQuiz, updateQuizAnswer } from '../../lib/questionnaireSchema';
import { defaultQuiz, type Quiz, type Weekday } from '../../state/AppState';
import { generateWorkoutPrescriptionRouted } from '../../workoutPrescription/generatePrescription';
import { MIN_WEEKLY_DAYS, maxWeeklyDaysForLevel } from '../weeklyDayAllowance';
import {
  availableFrequenciesForLevel,
  isWeeklyScheduleComplete,
  selectFlexibleFrequency,
  selectFlexibleSchedule,
  toggleFixedTrainingDay,
  type WeeklyScheduleValue,
} from '../weeklyScheduleSelection';

const WEEK: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const LEVELS = ['beginner', 'intermediate', 'intermediate_experienced', 'advanced'] as const;
const ENGINE_LEVEL: Record<string, string> = {
  beginner: 'BEGINNER', intermediate: 'INTERMEDIATE',
  intermediate_experienced: 'INTERMEDIATE', advanced: 'ADVANCED',
};

function quizWith(overrides: Partial<Quiz>): Quiz {
  return cleanApplicableAnswers({ ...defaultQuiz, ...overrides } as Quiz);
}

/** Replays the picker's own weekday handler under a ceiling. */
function tapDays(days: readonly Weekday[], maxDays: number): WeeklyScheduleValue {
  let value: WeeklyScheduleValue = { days: null, scheduleMode: 'fixed', trainingDays: [] };
  for (const day of days) value = toggleFixedTrainingDay(value, day, maxDays);
  return value;
}

describe('questionnaire — fixed mode honours each level’s bounds', () => {
  it.each(LEVELS)('%s stops at its own ceiling however many days are tapped', (level) => {
    const max = maxWeeklyDaysForLevel(level);
    const value = tapDays(WEEK, max);
    expect(value.days).toBe(max);
    expect(value.trainingDays).toEqual(WEEK.slice(0, max));
    expect(isWeeklyScheduleComplete(value, max)).toBe(true);
  });

  it.each(LEVELS)('%s can select every count inside its own range', (level) => {
    const max = maxWeeklyDaysForLevel(level);
    for (let days = MIN_WEEKLY_DAYS; days <= max; days += 1) {
      const value = tapDays(WEEK.slice(0, days), max);
      expect(value.days).toBe(days);
      expect(isWeeklyScheduleComplete(value, max)).toBe(true);
    }
  });

  it.each(LEVELS)('%s cannot complete below the two-day floor', (level) => {
    const max = maxWeeklyDaysForLevel(level);
    const oneDay = tapDays(['MON'], max);
    expect(oneDay.days).toBe(1);
    expect(isWeeklyScheduleComplete(oneDay, max)).toBe(false);
    const none = tapDays([], max);
    expect(isWeeklyScheduleComplete(none, max)).toBe(false);
  });

  it.each(LEVELS)('%s keeps WHICH days free at the ceiling', (level) => {
    const max = maxWeeklyDaysForLevel(level);
    let value = tapDays(WEEK.slice(0, max), max);
    const extra = WEEK[max];
    // At the ceiling the next day does not latch...
    value = toggleFixedTrainingDay(value, extra, max);
    expect(value.trainingDays).toEqual(WEEK.slice(0, max));
    // ...until a slot is freed, and then any day may take it.
    value = toggleFixedTrainingDay(value, WEEK[0], max);
    value = toggleFixedTrainingDay(value, extra, max);
    expect(value.trainingDays).toHaveLength(max);
    expect(value.trainingDays).toContain(extra);
    expect(value.trainingDays).not.toContain(WEEK[0]);
  });
});

describe('questionnaire — flexible mode honours each level’s bounds', () => {
  it.each(LEVELS)('%s is offered exactly its own frequencies', (level) => {
    const max = maxWeeklyDaysForLevel(level);
    const offered = availableFrequenciesForLevel(level);
    expect(offered[0]).toBe(MIN_WEEKLY_DAYS);
    expect(offered[offered.length - 1]).toBe(max);
    expect(offered).not.toContain(7);
  });

  it.each(LEVELS)('%s accepts every offered frequency and refuses one above', (level) => {
    const max = maxWeeklyDaysForLevel(level);
    for (const days of availableFrequenciesForLevel(level)) {
      const value = selectFlexibleFrequency(days, max);
      expect(value.days).toBe(days);
      expect(isWeeklyScheduleComplete(value, max)).toBe(true);
    }
    expect(selectFlexibleFrequency(max + 1, max).days).toBeNull();
    expect(selectFlexibleFrequency(7, max).days).toBeNull();
  });

  it.each(LEVELS)('%s drops an over-ceiling frequency when switching to flexible', (level) => {
    const max = maxWeeklyDaysForLevel(level);
    expect(selectFlexibleSchedule(
      { days: 7, scheduleMode: 'fixed', trainingDays: [...WEEK] }, max,
    )).toEqual({ days: null, scheduleMode: 'flexible', trainingDays: null });
  });
});

describe('questionnaire — nobody reaches seven days', () => {
  it.each(LEVELS)('%s cannot complete a seven-day schedule in either mode', (level) => {
    const max = maxWeeklyDaysForLevel(level);
    expect(isWeeklyScheduleComplete(
      { days: 7, scheduleMode: 'fixed', trainingDays: [...WEEK] }, max,
    )).toBe(false);
    expect(isWeeklyScheduleComplete(
      { days: 7, scheduleMode: 'flexible', trainingDays: null }, max,
    )).toBe(false);
  });
});

describe('normalization — the bounds survive every edit', () => {
  it.each(LEVELS)('%s has an over-ceiling fixed schedule trimmed, never left invalid', (level) => {
    const max = maxWeeklyDaysForLevel(level);
    const quiz = quizWith({ level, scheduleMode: 'fixed', days: 7, trainingDays: [...WEEK] });
    expect(quiz.days).toBe(max);
    expect(quiz.trainingDays).toEqual(WEEK.slice(0, max));
    expect(isWeeklyScheduleComplete(quiz, max)).toBe(true);
  });

  it.each(LEVELS)('%s has an over-ceiling flexible frequency trimmed', (level) => {
    const quiz = quizWith({ level, scheduleMode: 'flexible', days: 7, trainingDays: null });
    expect(quiz.days).toBe(maxWeeklyDaysForLevel(level));
    expect(quiz.trainingDays).toBeNull();
  });

  it('changing the level down to beginner re-applies the tighter ceiling', () => {
    const asAdvanced = quizWith({
      level: 'advanced', scheduleMode: 'fixed', days: 6, trainingDays: WEEK.slice(0, 6),
    });
    expect(asAdvanced.days).toBe(6);
    const asBeginner = updateQuizAnswer(asAdvanced, 'level', 'beginner');
    expect(asBeginner.days).toBe(3);
    expect(asBeginner.trainingDays).toEqual(['MON', 'TUE', 'WED']);
    expect(isWeeklyScheduleComplete(asBeginner, maxWeeklyDaysForLevel('beginner'))).toBe(true);
  });

  it('changing the level up relaxes the ceiling again', () => {
    const asBeginner = quizWith({
      level: 'beginner', scheduleMode: 'fixed', days: 3, trainingDays: ['MON', 'WED', 'FRI'],
    });
    const asIntermediate = updateQuizAnswer(asBeginner, 'level', 'intermediate');
    expect(maxWeeklyDaysForLevel(asIntermediate.level)).toBe(6);
    const extended = toggleFixedTrainingDay(asIntermediate, 'SAT', 6);
    expect(extended.days).toBe(4);
  });

  /**
   * The read path must stay lossless: an account persisted before this policy
   * keeps whatever it has until the user actively edits it. Only
   * `cleanApplicableAnswers` (edit/persist) applies the bounds.
   */
  it('loading a stored seven-day questionnaire does not rewrite it', () => {
    const loaded = normalizeLoadedQuiz({
      ...defaultQuiz, level: 'advanced', scheduleMode: 'fixed', days: 7, trainingDays: [...WEEK],
    } as never);
    expect(loaded.days).toBe(7);
    expect(loaded.trainingDays).toEqual(WEEK);
    // ...but it cannot be completed or advanced with, so it is never silently accepted.
    expect(isWeeklyScheduleComplete(loaded, maxWeeklyDaysForLevel('advanced'))).toBe(false);
  });
});

/**
 * The reason the bounds exist: inside them, the availability the user states
 * is exactly the training frequency the engine prescribes. Reads the engine
 * only — nothing here configures it.
 */
describe('availability now equals prescribed frequency for every allowed selection', () => {
  it.each(LEVELS)('%s', (level) => {
    for (const days of availableFrequenciesForLevel(level)) {
      const answers = {
        sex: 'm', goal: 'gain_muscle', level, days, trainingDays: WEEK.slice(0, days),
        duration: '60', place: 'gym', equipment: [], style: [], muscleFocus: [],
        specialConditions: ['none'], scheduleMode: 'fixed',
        pregnancyScreening: null, postpartumScreening: null, functionalScreening: null,
        lipedemaScreening: null, dizzinessScreening: null, postSurgicalScreening: null,
        medicalRestrictionScreening: null,
      };
      const result = generateWorkoutPrescriptionRouted(
        answers as never, ENGINE_LEVEL[level] as never, {}, 'v1.27',
      ) as { status?: string; plan?: { requestedDays?: number; prescribedTrainingFrequency?: number } };
      expect(result.status).toBe('SUCCESS');
      expect(result.plan?.requestedDays).toBe(days);
      expect(result.plan?.prescribedTrainingFrequency).toBe(days);
    }
  });
});
