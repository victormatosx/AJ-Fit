import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import {
  createFakeFirestore,
  type FakeFirestoreHarness,
} from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';
import {
  claimAchievementMilestone,
  completeAchievementMilestone,
  releaseAchievementMilestoneClaim,
} from '../achievementMilestones';
import {
  claimDailyProductWindow,
  completeDailyProductWindow,
  releaseDailyProductWindowClaim,
  DAILY_PRODUCT_WINDOWS_COLLECTION,
} from '../dailyProductRateLimit';
import { evaluateDailyNotificationSuite } from '../dailyNotificationSuite';
import { evaluateDailyWorkoutNotification, type DailyWorkoutContext } from '../dailyWorkoutNotifications';
import { evaluateEvolutionApproaching } from '../evolutionApproachingNotification';
import { evaluateProgressNotification } from '../progressNotification';
import { evaluateReEngagementNotification } from '../reengagementNotification';
import { evaluateWeeklyAchievementNotification } from '../weeklyAchievementNotification';

const UID = 'uid-1';
const LOCAL_DATE = '2026-09-07';
const NOW = Timestamp.fromDate(new Date('2026-09-07T08:30:00.000Z'));

type Toggles = {
  WORKOUTS_AND_REMINDERS?: boolean;
  EVOLUTION_AND_ACHIEVEMENTS?: boolean;
  PROGRESS?: boolean;
};

function accepted() {
  return {
    status: 'PENDING_RECEIPTS' as const,
    dispatchId: 'dispatch-1',
    deviceCount: 1,
    acceptedCount: 1,
  };
}

/** Real product-window and milestone fences over an in-memory Firestore. */
function fences(harness: FakeFirestoreHarness) {
  const db = harness.db as never;
  return {
    claimProductWindow: (input: never, now: Timestamp) => claimDailyProductWindow(db, input, now),
    completeProductWindow: (input: never, now: Timestamp) => completeDailyProductWindow(db, input, now),
    releaseProductWindow: (input: never) => releaseDailyProductWindowClaim(db, input),
    claimMilestone: (request: never, now: Timestamp) => claimAchievementMilestone(db, request, now),
    completeMilestone: (input: never, now: Timestamp) => completeAchievementMilestone(db, input, now),
    releaseMilestone: (input: never) => releaseAchievementMilestoneClaim(db, input),
  };
}

function policyFor(toggles: Toggles, category: keyof Toggles) {
  return vi.fn(async () => (toggles[category] === false
    ? { allowed: false, reason: 'DISABLED_BY_USER', locale: 'pt-BR' as const }
    : { allowed: true, reason: 'ALLOWED', locale: 'pt-BR' as const }));
}

function workoutContext(): DailyWorkoutContext {
  return {
    status: 'READY',
    timezone: 'UTC',
    programId: 'wpg-1',
    programInstanceId: 'wpi-1',
    activatedAtLocalDate: LOCAL_DATE,
    weeklySchedule: (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const).map((weekday) => ({
      weekday,
      state: weekday === 'MON' ? 'TRAINING' as const : 'REST' as const,
    })),
    sessionCount: 1,
    scheduleState: null,
  };
}

/**
 * Wires every daily observer to the same real fences, so a suppressed
 * candidate that never should have touched the shared slot is observable.
 */
function suite(toggles: Toggles, options: {
  hasApproaching?: boolean;
  hasWeeklyAchievement?: boolean;
  hasReengagement?: boolean;
} = {}) {
  const harness = createFakeFirestore();
  const shared = fences(harness);
  const sent: string[] = [];
  const dispatchCandidate = vi.fn(async (candidate: { build(locale: 'pt-BR'): { type: string } }) => {
    sent.push(candidate.build('pt-BR').type);
    return accepted();
  });

  const dependencies = {
    evaluateReEngagement: (uid: string) => evaluateReEngagementNotification(uid, {
      now: () => NOW,
      readContext: vi.fn(async () => (options.hasReengagement === false
        ? {
            allowed: false as const,
            reason: 'INSUFFICIENT_MISSED_OPPORTUNITIES',
            timezone: 'UTC',
            localDate: LOCAL_DATE,
          }
        : {
            allowed: true as const,
            notificationType: 'RE_ENGAGEMENT_EARLY' as const,
            episodeIdentity: 'wpi-1:2026-09-01',
            missedOpportunityCount: 3,
            timezone: 'UTC',
            localDate: LOCAL_DATE,
          })),
      resolvePolicy: policyFor(toggles, 'WORKOUTS_AND_REMINDERS'),
      dispatchCandidate,
      ...shared,
    } as never),
    evaluateWeeklyAchievement: (uid: string) => evaluateWeeklyAchievementNotification(uid, {
      now: () => NOW,
      readContext: vi.fn(async () => (options.hasWeeklyAchievement
        ? {
            allowed: true as const,
            candidate: {
              notificationType: 'WEEK_COMPLETED' as const,
              achievementIdentity: 'wpi-1:2026-08-31',
              week: { weekStart: '2026-08-31' },
            },
            timezone: 'UTC',
            localDate: LOCAL_DATE,
          }
        : { allowed: false as const, reason: 'NO_WEEKLY_ACHIEVEMENT', timezone: 'UTC', localDate: LOCAL_DATE })),
      resolvePolicy: policyFor(toggles, 'EVOLUTION_AND_ACHIEVEMENTS'),
      dispatchCandidate,
      ...shared,
    } as never),
    evaluateApproaching: (uid: string) => evaluateEvolutionApproaching(uid, {
      now: () => NOW,
      readContext: vi.fn(async () => (options.hasApproaching
        ? {
            allowed: true as const,
            progressionWindowId: 'wpi-1',
            sourceIdentity: 'progressionWindow:hash',
            timezone: 'UTC',
            localDate: LOCAL_DATE,
          }
        : { allowed: false as const, reason: 'OUTSIDE_APPROACHING_WINDOW', timezone: 'UTC', localDate: LOCAL_DATE })),
      resolvePolicy: policyFor(toggles, 'EVOLUTION_AND_ACHIEVEMENTS'),
      claim: shared.claimMilestone,
      complete: shared.completeMilestone,
      dispatchCandidate,
      ...shared,
    } as never),
    evaluateWorkout: (uid: string) => evaluateDailyWorkoutNotification(uid, {
      db: harness.db as never,
      now: () => NOW,
      loadContext: vi.fn(async () => workoutContext()),
      hasFinishedExecution: vi.fn(async () => false),
      resolvePolicy: policyFor(toggles, 'WORKOUTS_AND_REMINDERS'),
      dispatchCandidate,
      ...shared,
    } as never),
    evaluateProgress: (uid: string) => evaluateProgressNotification(uid, {
      now: () => NOW,
      readContext: vi.fn(async () => ({
        allowed: true as const,
        candidates: [{
          notificationType: 'COMPARE_PROGRESS' as const,
          progressIdentity: 'photoComparison:2026-07-01:2026-09-01',
        }],
        timezone: 'UTC',
        localDate: LOCAL_DATE,
      })),
      resolvePolicy: policyFor(toggles, 'PROGRESS'),
      dispatchCandidate,
      ...shared,
    } as never),
  };

  return {
    harness,
    sent,
    run: () => evaluateDailyNotificationSuite(UID, dependencies as never),
    windowCount: () => harness.listUnder(DAILY_PRODUCT_WINDOWS_COLLECTION).length,
  };
}

describe('daily product window across notification categories', () => {
  it('never lets a disabled workouts category consume the day a PROGRESS candidate needs', async () => {
    const { run, sent, windowCount } = suite({
      WORKOUTS_AND_REMINDERS: false,
      PROGRESS: true,
    });
    await expect(run()).resolves.toMatchObject({ status: 'DISPATCHED' });
    expect(sent).toEqual(['COMPARE_PROGRESS']);
    expect(windowCount()).toBe(1);
  });

  it('never lets a disabled achievements category consume the day a workout candidate needs', async () => {
    const { run, sent, windowCount } = suite(
      { EVOLUTION_AND_ACHIEVEMENTS: false, WORKOUTS_AND_REMINDERS: true },
      { hasApproaching: true, hasWeeklyAchievement: true, hasReengagement: false },
    );
    await expect(run()).resolves.toMatchObject({ status: 'DISPATCHED' });
    // WEEK_COMPLETED and EVOLUTION_APPROACHING both outrank WORKOUT_DAY, and
    // both are disabled — neither may burn the slot on the way past.
    expect(sent).toEqual(['WORKOUT_DAY']);
    expect(windowCount()).toBe(1);
  });

  it('never lets a disabled PROGRESS candidate block an enabled workout candidate', async () => {
    const { run, sent } = suite(
      { PROGRESS: false, WORKOUTS_AND_REMINDERS: true },
      { hasReengagement: false },
    );
    await expect(run()).resolves.toMatchObject({ status: 'DISPATCHED' });
    expect(sent).toEqual(['WORKOUT_DAY']);
  });

  it('sends exactly one product notification when several tiers are simultaneously eligible', async () => {
    const { run, sent, windowCount } = suite(
      { WORKOUTS_AND_REMINDERS: true, EVOLUTION_AND_ACHIEVEMENTS: true, PROGRESS: true },
      { hasApproaching: true, hasWeeklyAchievement: true },
    );
    await expect(run()).resolves.toMatchObject({ status: 'DISPATCHED' });
    expect(sent).toEqual(['RE_ENGAGEMENT_EARLY']);
    expect(windowCount()).toBe(1);
  });

  it('keeps EVOLUTION_APPROACHING and WORKOUT_DAY from both winning the same local day', async () => {
    const { run, sent, windowCount } = suite(
      { WORKOUTS_AND_REMINDERS: true, EVOLUTION_AND_ACHIEVEMENTS: true },
      { hasApproaching: true, hasReengagement: false },
    );
    await run();
    expect(sent).toEqual(['EVOLUTION_APPROACHING']);
    expect(windowCount()).toBe(1);
  });

  it('lets the workout candidate take the day the next time approaching already fired', async () => {
    const first = suite(
      { WORKOUTS_AND_REMINDERS: true, EVOLUTION_AND_ACHIEVEMENTS: true },
      { hasApproaching: true, hasReengagement: false },
    );
    await first.run();
    expect(first.sent).toEqual(['EVOLUTION_APPROACHING']);

    // A second scheduler worker on the same local day must find both fences
    // closed rather than sending a second product push.
    await first.run();
    expect(first.sent).toEqual(['EVOLUTION_APPROACHING']);
    expect(first.windowCount()).toBe(1);
  });

  it('reports a preference suppression as SUPPRESSED, never as DISPATCHED', async () => {
    const { run } = suite({
      WORKOUTS_AND_REMINDERS: false,
      EVOLUTION_AND_ACHIEVEMENTS: false,
      PROGRESS: false,
    });
    const result = await run();
    expect(result.status).toBe('SUPPRESSED');
    expect(result.reason).toContain('DISABLED_BY_USER');
  });
});
