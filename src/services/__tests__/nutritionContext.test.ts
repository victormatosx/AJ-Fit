import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { resolveNutritionPhysicalContextFromSources, resolveWorkoutNutritionContextFromSources } from '../nutritionContext';
import type { UserProfile } from '../userProfile';
import type { AssessmentDoc } from '../assessments';
import type { Quiz } from '../../state/AppState';

vi.mock('../../lib/firebase', () => ({ db: {} }));

const older = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
const newer = Timestamp.fromDate(new Date('2026-10-01T00:00:00Z'));
const quiz = { birthDate: new Date('2000-06-15T12:00:00Z'), height: 170, sex: 'f', goal: 'lose_fat', days: 3 } as Quiz;
const profile = { profile: { birthDate: Timestamp.fromDate(new Date('1999-06-15T12:00:00Z')), height: 175 } } as UserProfile;
const assessments = [
  { measuredAt: older, createdAt: newer, weight: 68 },
  { measuredAt: newer, createdAt: older, weight: 64 },
] as AssessmentDoc[];

describe('Nutrition physical context', () => {
  it('prefers mutable profile birthDate and height, latest measuredAt weight, and Quiz sex/goal', () => {
    const result = resolveNutritionPhysicalContextFromSources(profile, quiz, assessments, new Date('2026-10-08T12:00:00Z'));
    expect(result).toMatchObject({ ageYears: 27, heightCm: 175, weightKg: 64, sex: 'f', goal: 'lose_fat',
      sources: { birthDate: 'profile', height: 'profile', weight: 'assessment', sex: 'questionnaire', goal: 'questionnaire' } });
  });
  it('falls back independently to Quiz birthDate and height', () => {
    const result = resolveNutritionPhysicalContextFromSources(null, quiz, assessments, new Date('2026-10-08T12:00:00Z'));
    expect(result).toMatchObject({ ageYears: 26, heightCm: 170,
      sources: { birthDate: 'questionnaire', height: 'questionnaire' } });
  });
  it('requires assessment weight, sex and goal', () => {
    expect(resolveNutritionPhysicalContextFromSources(profile, quiz, [])).toBeNull();
    expect(resolveNutritionPhysicalContextFromSources(profile, { ...quiz, sex: null }, assessments)).toBeNull();
    expect(resolveNutritionPhysicalContextFromSources(profile, { ...quiz, goal: null }, assessments)).toBeNull();
  });
});

describe('Workout Nutrition context', () => {
  it('uses prescribed frequency, including flexible schedules', () => {
    expect(resolveWorkoutNutritionContextFromSources({ prescribedTrainingFrequency: 4, prescribedStructuredDays: 2 }, 5)).toEqual({ weeklyTrainingFrequency: 4 });
    expect(resolveWorkoutNutritionContextFromSources({ prescribedTrainingFrequency: 4, scheduleMode: 'flexible' } as { prescribedTrainingFrequency: number }, 5)).toEqual({ weeklyTrainingFrequency: 4 });
  });
  it('uses legacy alias, then Quiz.days only without a program, then zero', () => {
    expect(resolveWorkoutNutritionContextFromSources({ prescribedStructuredDays: 2 }, 5).weeklyTrainingFrequency).toBe(2);
    expect(resolveWorkoutNutritionContextFromSources(null, 5).weeklyTrainingFrequency).toBe(5);
    expect(resolveWorkoutNutritionContextFromSources(null, null).weeklyTrainingFrequency).toBe(0);
    expect(resolveWorkoutNutritionContextFromSources({ requestedDays: 6 } as {}, 5).weeklyTrainingFrequency).toBe(0);
  });
});
