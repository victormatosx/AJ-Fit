import { describe, expect, it } from 'vitest';
import { buildUpcomingWorkouts } from '../upcomingWorkouts';
import type { FinalWorkoutSession } from '../../workoutPrescription/types';

const trainingDays = ['MON', 'WED', 'FRI'] as const;

function sessions(count: number): FinalWorkoutSession[] {
  return Array.from({ length: count }, (_, index) => ({
    name: String.fromCharCode(65 + index),
    type: 'resistance',
    exercises: [
      { exerciseId: `e${index}a`, sourceExerciseId: `e${index}a`, sets: 3, reps: '10-12', restSeconds: 90 },
      { exerciseId: `e${index}b`, sourceExerciseId: `e${index}b`, sets: 3, reps: '10-12', restSeconds: 90 },
    ],
  }));
}

describe('buildUpcomingWorkouts', () => {
  it('starts AFTER today when today still has a session to do', () => {
    // 2026-09-09 is a Wednesday; next training days are Fri 11 and Mon 14.
    const upcoming = buildUpcomingWorkouts({
      todayLocalDate: '2026-09-09',
      trainingDays,
      sessions: sessions(3),
      resolution: { status: 'SESSION_READY', sessionIndex: 0 },
    });

    expect(upcoming.map((item) => item.localDate)).toEqual(['2026-09-11', '2026-09-14', '2026-09-16']);
    expect(upcoming.map((item) => item.sessionIndex)).toEqual([1, 2, 0]);
    expect(upcoming.map((item) => item.weekday)).toEqual(['FRI', 'MON', 'WED']);
  });

  it("uses the engine's own nextWorkoutDate/nextSessionIndex on a rest day", () => {
    const upcoming = buildUpcomingWorkouts({
      todayLocalDate: '2026-09-10', // Thursday
      trainingDays,
      sessions: sessions(3),
      resolution: { status: 'REST_DAY', nextWorkoutDate: '2026-09-11', nextSessionIndex: 2 },
    });

    expect(upcoming[0]).toMatchObject({ localDate: '2026-09-11', sessionIndex: 2 });
    expect(upcoming[1]).toMatchObject({ localDate: '2026-09-14', sessionIndex: 0 });
  });

  it('does not repeat today after it is already completed', () => {
    const upcoming = buildUpcomingWorkouts({
      todayLocalDate: '2026-09-09',
      trainingDays,
      sessions: sessions(3),
      resolution: { status: 'TODAY_COMPLETED', nextWorkoutDate: '2026-09-11', nextSessionIndex: 1 },
    });

    expect(upcoming.every((item) => item.localDate > '2026-09-09')).toBe(true);
    expect(upcoming[0].sessionIndex).toBe(1);
  });

  it('previews the CONTINUE_SEQUENCE reading while a miss decision is pending', () => {
    // The Today poster previews `missedSessionIndex` (2), so "próximos" continues from 0.
    const upcoming = buildUpcomingWorkouts({
      todayLocalDate: '2026-09-09',
      trainingDays,
      sessions: sessions(3),
      resolution: {
        status: 'MISSED_SESSION_DECISION_REQUIRED',
        missedSessionIndex: 2,
        calendarSessionIndex: 0,
        missedScheduledDate: '2026-09-08',
      },
    });

    expect(upcoming[0]).toMatchObject({ localDate: '2026-09-11', sessionIndex: 0 });
  });

  it('is empty when there is no program or no schedule yet', () => {
    for (const resolution of [
      { status: 'PROGRAM_NOT_AVAILABLE' },
      { status: 'SCHEDULE_SETUP_REQUIRED' },
    ] as const) {
      expect(buildUpcomingWorkouts({
        todayLocalDate: '2026-09-09', trainingDays, sessions: sessions(3), resolution,
      })).toEqual([]);
    }
  });

  it('is empty without training days, sessions, or a resolution', () => {
    const base = {
      todayLocalDate: '2026-09-09',
      trainingDays,
      sessions: sessions(3),
      resolution: { status: 'SESSION_READY', sessionIndex: 0 } as const,
    };
    expect(buildUpcomingWorkouts({ ...base, trainingDays: [] })).toEqual([]);
    expect(buildUpcomingWorkouts({ ...base, sessions: [] })).toEqual([]);
    expect(buildUpcomingWorkouts({ ...base, resolution: null })).toEqual([]);
  });

  it('wraps the rotation and repeats a session when the plan has fewer sessions than the limit', () => {
    const upcoming = buildUpcomingWorkouts({
      todayLocalDate: '2026-09-09',
      trainingDays,
      sessions: sessions(2),
      resolution: { status: 'SESSION_READY', sessionIndex: 0 },
    });

    expect(upcoming.map((item) => item.sessionIndex)).toEqual([1, 0, 1]);
  });

  it('honors an explicit limit', () => {
    const upcoming = buildUpcomingWorkouts({
      todayLocalDate: '2026-09-09',
      trainingDays,
      sessions: sessions(3),
      resolution: { status: 'SESSION_READY', sessionIndex: 0 },
      limit: 5,
    });
    expect(upcoming).toHaveLength(5);
    expect(buildUpcomingWorkouts({
      todayLocalDate: '2026-09-09',
      trainingDays,
      sessions: sessions(3),
      resolution: { status: 'SESSION_READY', sessionIndex: 0 },
      limit: 0,
    })).toEqual([]);
  });

  it('carries the presentation facts each row needs', () => {
    const upcoming = buildUpcomingWorkouts({
      todayLocalDate: '2026-09-09',
      trainingDays,
      sessions: sessions(3),
      resolution: { status: 'SESSION_READY', sessionIndex: 0 },
    });

    expect(upcoming[0].sessionName).toBe('B');
    expect(upcoming[0].sessionType).toBe('resistance');
    expect(upcoming[0].exerciseCount).toBe(2);
    expect(upcoming[0].estimatedMinutes).toBeGreaterThan(0);
  });

  it('flexible presents the next sessions in circular sequence without calendar dates', () => {
    const upcoming = buildUpcomingWorkouts({
      scheduleMode: 'flexible',
      todayLocalDate: '2026-09-10',
      trainingDays: [],
      sessions: sessions(4),
      resolution: { status: 'SESSION_READY', sessionIndex: 1 },
    });
    expect(upcoming.map((item) => item.sessionIndex)).toEqual([2, 3, 0]);
    expect(upcoming.every((item) => item.sessionIndex !== 1)).toBe(true);
    expect(upcoming.every((item) => item.flexible)).toBe(true);
  });

  it.each([
    [0, [1, 2, 3]],
    [1, [2, 3, 0]],
    [3, [0, 1, 2]],
  ])('flexible wraps the next three sessions from current=%s', (current, expected) => {
    const upcoming = buildUpcomingWorkouts({
      scheduleMode: 'flexible', todayLocalDate: '2026-09-10', trainingDays: [],
      sessions: sessions(4), resolution: { status: 'SESSION_READY', sessionIndex: current },
    });
    expect(upcoming.map((item) => item.sessionIndex)).toEqual(expected);
  });

  it.each([
    [3, 0, [1, 2]],
    [2, 0, [1]],
  ])('flexible never repeats the current session for %s prescribed sessions', (sessionCount, current, expected) => {
    const upcoming = buildUpcomingWorkouts({
      scheduleMode: 'flexible', todayLocalDate: '2026-09-10', trainingDays: [],
      sessions: sessions(sessionCount), resolution: { status: 'SESSION_READY', sessionIndex: current },
    });
    expect(upcoming.map((item) => item.sessionIndex)).toEqual(expected);
    expect(upcoming.every((item) => item.sessionIndex !== current)).toBe(true);
  });

  it('recomputes flexible previews when the authoritative cursor advances', () => {
    const input = {
      scheduleMode: 'flexible' as const,
      todayLocalDate: '2026-09-10' as const,
      trainingDays: [] as const,
      sessions: sessions(4),
    };
    const before = buildUpcomingWorkouts({ ...input, resolution: { status: 'SESSION_READY', sessionIndex: 0 } });
    const after = buildUpcomingWorkouts({ ...input, resolution: { status: 'SESSION_READY', sessionIndex: 1 } });
    expect(before.map((item) => item.sessionIndex)).toEqual([1, 2, 3]);
    expect(after.map((item) => item.sessionIndex)).toEqual([2, 3, 0]);
  });
});
