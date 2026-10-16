import { describe, expect, it } from 'vitest';
import { buildTreinoWeekStrip } from '../treinoWeekStrip';
import type { WeekOverviewViewModel } from '../weekOverview';
import type { ScheduleResolution } from '../../scheduleEngine/types';
import type { FinalWorkoutSession } from '../../workoutPrescription/types';

function session(name: string): FinalWorkoutSession {
  return { name, type: 'resistance', exercises: [] };
}

const SESSIONS = [session('A'), session('B'), session('C')];

// Monday 2026-10-12 .. Sunday 2026-10-18. Training days MON/WED/FRI.
function overview(statusByDate: Record<string, WeekOverviewViewModel['days'][number]['status']>, todayLocalDate: string): WeekOverviewViewModel {
  const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
  const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
  const days = dates.map((localDate, index) => ({
    localDate,
    weekday: weekdays[index],
    status: statusByDate[localDate] ?? 'REST',
    isToday: localDate === todayLocalDate,
  }));
  return { days, scheduledCount: 3, completedCount: 0 };
}

describe('buildTreinoWeekStrip', () => {
  it('labels today with the resolution cursor and the next training day with the projected letter', () => {
    const todayLocalDate = '2026-10-12'; // Monday
    const resolution: ScheduleResolution = { status: 'SESSION_READY', sessionIndex: 0 };
    const result = buildTreinoWeekStrip({
      overview: overview({ '2026-10-12': 'TODAY_PENDING', '2026-10-14': 'UPCOMING', '2026-10-16': 'UPCOMING' }, todayLocalDate),
      todayLocalDate,
      scheduleMode: 'fixed',
      trainingDays: ['MON', 'WED', 'FRI'],
      sessions: SESSIONS,
      resolution,
      nextSessionIndex: 0,
    });

    const monday = result.find((day) => day.localDate === '2026-10-12')!;
    expect(monday.isTrainingDay).toBe(true);
    expect(monday.glyph).toBeNull();
    expect(monday.sessionIndex).toBe(0);
    expect(monday.isNextSession).toBe(true);

    const wednesday = result.find((day) => day.localDate === '2026-10-14')!;
    expect(wednesday.sessionIndex).toBe(1);
    expect(wednesday.isNextSession).toBe(false);

    const friday = result.find((day) => day.localDate === '2026-10-16')!;
    expect(friday.sessionIndex).toBe(2);

    const tuesday = result.find((day) => day.localDate === '2026-10-13')!;
    expect(tuesday.isTrainingDay).toBe(false);
    expect(tuesday.sessionIndex).toBeNull();
  });

  it('keeps the week-overview glyph for MISSED/COMPLETED/FULFILLED_EARLY days and never attaches a session letter to them', () => {
    const todayLocalDate = '2026-10-16'; // Friday
    const resolution: ScheduleResolution = { status: 'SESSION_READY', sessionIndex: 2 };
    const result = buildTreinoWeekStrip({
      overview: overview({
        '2026-10-12': 'COMPLETED',
        '2026-10-14': 'MISSED',
        '2026-10-16': 'TODAY_PENDING',
      }, todayLocalDate),
      todayLocalDate,
      scheduleMode: 'fixed',
      trainingDays: ['MON', 'WED', 'FRI'],
      sessions: SESSIONS,
      resolution,
      nextSessionIndex: 2,
    });

    const monday = result.find((day) => day.localDate === '2026-10-12')!;
    expect(monday.glyph).toBe('COMPLETED');
    expect(monday.sessionIndex).toBeNull();
    expect(monday.isNextSession).toBe(false);

    const wednesday = result.find((day) => day.localDate === '2026-10-14')!;
    expect(wednesday.glyph).toBe('MISSED');
    expect(wednesday.sessionIndex).toBeNull();

    const friday = result.find((day) => day.localDate === '2026-10-16')!;
    expect(friday.glyph).toBeNull();
    expect(friday.sessionIndex).toBe(2);
    expect(friday.isNextSession).toBe(true);
  });

  it('marks the first upcoming day as next when today itself has no pending session (REST_DAY)', () => {
    const todayLocalDate = '2026-10-13'; // Tuesday, a REST day
    const resolution: ScheduleResolution = { status: 'REST_DAY', nextWorkoutDate: '2026-10-14', nextSessionIndex: 1 };
    const result = buildTreinoWeekStrip({
      overview: overview({ '2026-10-12': 'COMPLETED', '2026-10-14': 'UPCOMING' }, todayLocalDate),
      todayLocalDate,
      scheduleMode: 'fixed',
      trainingDays: ['MON', 'WED', 'FRI'],
      sessions: SESSIONS,
      resolution,
      nextSessionIndex: 1,
    });

    const wednesday = result.find((day) => day.localDate === '2026-10-14')!;
    expect(wednesday.sessionIndex).toBe(1);
    expect(wednesday.isNextSession).toBe(true);
  });
});
