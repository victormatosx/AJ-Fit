import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import type { DailyWorkoutContext } from '../dailyWorkoutNotifications';
import {
  deriveReEngagementEpisode,
  readReEngagementContext,
  RE_ENGAGEMENT_EARLY_MISSED_OPPORTUNITIES,
  RE_ENGAGEMENT_LATE_MISSED_OPPORTUNITIES,
} from '../reengagementContext';

const MWF = ['MON', 'WED', 'FRI'] as const;

function input(overrides: Partial<Parameters<typeof deriveReEngagementEpisode>[0]> = {}) {
  return {
    programInstanceId: 'instance-1',
    activatedAtLocalDate: '2026-09-07',
    lastCompletedAt: null,
    trainingDays: MWF,
    todayLocalDate: '2026-09-14',
    ...overrides,
  };
}

function week(trainingDays: readonly string[], recoveryDays: readonly string[] = []) {
  return (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const).map((weekday) => ({
    weekday,
    state: trainingDays.includes(weekday)
      ? 'TRAINING' as const
      : recoveryDays.includes(weekday)
        ? 'ACTIVE_RECOVERY' as const
        : 'REST' as const,
  }));
}

function workoutContext(overrides: Partial<DailyWorkoutContext> = {}): DailyWorkoutContext {
  return {
    status: 'READY',
    timezone: 'America/New_York',
    programId: 'program-1',
    programInstanceId: 'instance-1',
    activatedAtLocalDate: '2026-03-02',
    weeklySchedule: week(MWF, ['TUE']),
    sessionCount: 3,
    scheduleState: {
      nextSessionIndex: 1,
      cursorDate: '2026-03-02',
      pendingMissDecision: null,
      lastCompletedAt: '2026-03-02',
    },
    resolvedMissScheduledDate: null,
    ...overrides,
  };
}

describe('canonical workout re-engagement episode', () => {
  it('uses elapsed time and weekly frequency for flexible plans, not weekday debt', () => {
    expect(deriveReEngagementEpisode(input({
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 3,
      trainingDays: [],
      activatedAtLocalDate: '2026-09-01',
      todayLocalDate: '2026-09-09',
    }))).toMatchObject({
      allowed: true,
      notificationType: 'RE_ENGAGEMENT_EARLY',
      missedOpportunityCount: 3,
    });
  });

  it('anchors EARLY to the existing Progression V2 inactivity threshold', () => {
    expect(RE_ENGAGEMENT_EARLY_MISSED_OPPORTUNITIES).toBe(3);
    expect(deriveReEngagementEpisode(input())).toMatchObject({
      allowed: true,
      notificationType: 'RE_ENGAGEMENT_EARLY',
      episodeIdentity: 'instance-1:2026-09-07',
      missedOpportunityCount: 3,
    });
  });

  it('does not trigger before three prescribed opportunities are actually past', () => {
    expect(deriveReEngagementEpisode(input({ todayLocalDate: '2026-09-11' })))
      .toEqual({ allowed: false, reason: 'INSUFFICIENT_MISSED_OPPORTUNITIES' });
  });

  it('does not count a normal weekend, rest day, active recovery or today itself', () => {
    expect(deriveReEngagementEpisode(input({
      activatedAtLocalDate: '2026-09-04',
      lastCompletedAt: '2026-09-04',
      todayLocalDate: '2026-09-07',
    }))).toEqual({ allowed: false, reason: 'INSUFFICIENT_MISSED_OPPORTUNITIES' });
  });

  it('does not treat tomorrow\'s already-fulfilled opportunity as absence or invalid history', () => {
    expect(deriveReEngagementEpisode(input({
      activatedAtLocalDate: '2026-09-14',
      lastCompletedAt: '2026-09-18',
      todayLocalDate: '2026-09-17',
      trainingDays: ['MON', 'TUE', 'WED', 'FRI'],
    }))).toEqual({ allowed: false, reason: 'INSUFFICIENT_MISSED_OPPORTUNITIES' });
  });

  it('uses a second full inactivity block for LATE', () => {
    expect(RE_ENGAGEMENT_LATE_MISSED_OPPORTUNITIES).toBe(6);
    expect(deriveReEngagementEpisode(input({ todayLocalDate: '2026-09-19' })))
      .toMatchObject({
        allowed: true,
        notificationType: 'RE_ENGAGEMENT_LATE',
        missedOpportunityCount: 6,
      });
  });

  it('scales wall-clock timing with prescribed frequency', () => {
    const twiceWeekly = deriveReEngagementEpisode(input({
      activatedAtLocalDate: '2026-08-31',
      trainingDays: ['TUE', 'FRI'],
      todayLocalDate: '2026-09-09',
    }));
    const sixWeekly = deriveReEngagementEpisode(input({
      activatedAtLocalDate: '2026-09-07',
      trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
      todayLocalDate: '2026-09-10',
    }));
    expect(twiceWeekly).toMatchObject({ allowed: true, missedOpportunityCount: 3 });
    expect(sixWeekly).toMatchObject({ allowed: true, missedOpportunityCount: 3 });
  });

  it('closes an episode on completion and gives a later absence a new identity', () => {
    const episodeA = deriveReEngagementEpisode(input());
    const returned = deriveReEngagementEpisode(input({ lastCompletedAt: '2026-09-14' }));
    const episodeB = deriveReEngagementEpisode(input({
      lastCompletedAt: '2026-09-14',
      todayLocalDate: '2026-09-22',
    }));
    expect(returned).toEqual({ allowed: false, reason: 'INSUFFICIENT_MISSED_OPPORTUNITIES' });
    expect(episodeB).toMatchObject({
      allowed: true,
      episodeIdentity: 'instance-1:2026-09-16',
    });
    expect(episodeB).not.toMatchObject(episodeA);
  });

  it('allows EARLY and LATE once in episode A, then EARLY again in episode B', () => {
    const episodeAEarly = deriveReEngagementEpisode(input());
    const episodeALate = deriveReEngagementEpisode(input({ todayLocalDate: '2026-09-19' }));
    const returned = deriveReEngagementEpisode(input({
      lastCompletedAt: '2026-09-21',
      todayLocalDate: '2026-09-22',
    }));
    const episodeBEarly = deriveReEngagementEpisode(input({
      lastCompletedAt: '2026-09-21',
      todayLocalDate: '2026-09-29',
    }));

    expect(episodeAEarly).toMatchObject({
      notificationType: 'RE_ENGAGEMENT_EARLY',
      episodeIdentity: 'instance-1:2026-09-07',
    });
    expect(episodeALate).toMatchObject({
      notificationType: 'RE_ENGAGEMENT_LATE',
      episodeIdentity: 'instance-1:2026-09-07',
    });
    expect(returned).toEqual({ allowed: false, reason: 'INSUFFICIENT_MISSED_OPPORTUNITIES' });
    expect(episodeBEarly).toMatchObject({
      notificationType: 'RE_ENGAGEMENT_EARLY',
      episodeIdentity: 'instance-1:2026-09-23',
    });
  });

  it('changes episode identity when an adapted Program Instance replaces the old one', () => {
    const original = deriveReEngagementEpisode(input());
    const adapted = deriveReEngagementEpisode(input({ programInstanceId: 'instance-2' }));
    expect(adapted).toMatchObject({ episodeIdentity: 'instance-2:2026-09-07' });
    expect(adapted).not.toEqual(original);
  });

  it('resolves local time across DST and uses only TRAINING days from the canonical weekly schedule', async () => {
    const loadWorkoutContext = vi.fn(async () => workoutContext());
    const now = Timestamp.fromDate(new Date('2026-03-11T12:30:00.000Z'));
    await expect(readReEngagementContext({} as never, 'uid-1', now, { loadWorkoutContext }))
      .resolves.toMatchObject({
        allowed: true,
        notificationType: 'RE_ENGAGEMENT_EARLY',
        timezone: 'America/New_York',
        localDate: '2026-03-11',
        missedOpportunityCount: 3,
      });
  });

  it('fails closed outside 08:00–10:00 local time and for invalid history', async () => {
    const loadWorkoutContext = vi.fn(async () => workoutContext());
    await expect(readReEngagementContext(
      {} as never,
      'uid-1',
      Timestamp.fromDate(new Date('2026-03-11T11:59:00.000Z')),
      { loadWorkoutContext },
    )).resolves.toMatchObject({ allowed: false, reason: 'OUTSIDE_LOCAL_WINDOW' });
    expect(deriveReEngagementEpisode(input({ lastCompletedAt: '2026-09-23' })))
      .toEqual({ allowed: false, reason: 'HISTORY_UNAVAILABLE' });
  });

  it('lets dispatch preflight revalidate an episode outside the scheduler window', async () => {
    const loadWorkoutContext = vi.fn(async () => workoutContext());
    await expect(readReEngagementContext(
      {} as never,
      'uid-1',
      Timestamp.fromDate(new Date('2026-03-11T16:00:00.000Z')),
      { loadWorkoutContext },
      { requireDailyWindow: false },
    )).resolves.toMatchObject({
      allowed: true,
      notificationType: 'RE_ENGAGEMENT_EARLY',
      episodeIdentity: 'instance-1:2026-03-04',
    });
  });
});
