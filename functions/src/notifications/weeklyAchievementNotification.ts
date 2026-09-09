import { Timestamp } from 'firebase-admin/firestore';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import {
  claimAchievementMilestone,
  completeAchievementMilestone,
  releaseAchievementMilestoneClaim,
  type AchievementMilestoneClaim,
} from './achievementMilestones';
import {
  buildWeekCompletedNotification,
  buildWeekStreakNotification,
  type NotificationLocale,
} from './contentPolicy';
import {
  claimDailyProductWindow,
  completeDailyProductWindow,
  releaseDailyProductWindowClaim,
  type DailyProductWindowClaim,
} from './dailyProductRateLimit';
import {
  readWeeklyAchievementContext,
  type WeeklyAchievementCandidate,
  type WeeklyAchievementContext,
} from './weeklyAchievementContext';
import { resolveUserNotificationPolicy, type UserNotificationPolicyResult } from './preferences';
import type { NotificationDispatchOutcome, NotificationDispatchRequest } from './schema';
import { dispatchUserNotificationCandidate } from './userNotificationDispatch';

const SCOPE = 'notifications.weeklyAchievement';

export type WeeklyAchievementEvaluation = {
  status: 'DISPATCHED';
  notificationType: WeeklyAchievementCandidate['notificationType'];
  timezone: string;
  localDate: string;
  outcome: NotificationDispatchOutcome['status'];
} | {
  status: 'SUPPRESSED';
  reason: string;
  timezone?: string;
  localDate?: string;
} | {
  status: 'FAILED';
  timezone?: string;
  localDate?: string;
};

export interface WeeklyAchievementDependencies {
  now(): Timestamp;
  readContext(uid: string, now: Timestamp): Promise<WeeklyAchievementContext>;
  claimMilestone(request: NotificationDispatchRequest, now: Timestamp): Promise<AchievementMilestoneClaim>;
  completeMilestone(input: { milestoneId: string; claimToken: string; outcome: string }, now: Timestamp): Promise<boolean>;
  releaseMilestone(input: { milestoneId: string; claimToken: string }): Promise<boolean>;
  claimProductWindow(input: {
    uid: string;
    localDate: string;
    request: NotificationDispatchRequest;
  }, now: Timestamp): Promise<DailyProductWindowClaim>;
  completeProductWindow(input: { windowId: string; claimToken: string; outcome: string }, now: Timestamp): Promise<boolean>;
  releaseProductWindow(input: { windowId: string; claimToken: string }): Promise<boolean>;
  dispatchCandidate: typeof dispatchUserNotificationCandidate;
  resolvePolicy(uid: string): Promise<UserNotificationPolicyResult>;
}

function defaultDependencies(): WeeklyAchievementDependencies {
  return {
    now: Timestamp.now,
    readContext: (uid, now) => readWeeklyAchievementContext(defaultDb, uid, now),
    claimMilestone: (request, now) => claimAchievementMilestone(defaultDb, request, now),
    completeMilestone: (input, now) => completeAchievementMilestone(defaultDb, input, now),
    releaseMilestone: (input) => releaseAchievementMilestoneClaim(defaultDb, input),
    claimProductWindow: (input, now) => claimDailyProductWindow(defaultDb, input, now),
    completeProductWindow: (input, now) => completeDailyProductWindow(defaultDb, input, now),
    releaseProductWindow: (input) => releaseDailyProductWindowClaim(defaultDb, input),
    dispatchCandidate: dispatchUserNotificationCandidate,
    resolvePolicy: (uid) => resolveUserNotificationPolicy({
      uid, category: 'EVOLUTION_AND_ACHIEVEMENTS',
    }, defaultDb),
  };
}

export function buildWeeklyAchievementRequest(
  uid: string,
  candidate: WeeklyAchievementCandidate,
  locale: NotificationLocale,
): NotificationDispatchRequest {
  return candidate.notificationType === 'WEEK_STREAK'
    ? buildWeekStreakNotification({
        uid,
        achievementIdentity: candidate.achievementIdentity,
        locale,
        weeks: candidate.weeks,
      })
    : buildWeekCompletedNotification({
        uid,
        achievementIdentity: candidate.achievementIdentity,
        locale,
      });
}

function suppress(reason: string, input: { timezone?: string; localDate?: string } = {}): WeeklyAchievementEvaluation {
  logInfo(SCOPE, 'candidate_suppressed', { reason, ...input });
  return { status: 'SUPPRESSED', reason, ...input };
}

export async function evaluateWeeklyAchievementNotification(
  uid: string,
  dependencies: WeeklyAchievementDependencies = defaultDependencies(),
): Promise<WeeklyAchievementEvaluation> {
  const now = dependencies.now();
  let timezone: string | undefined;
  let localDate: string | undefined;
  let activeClaim: Extract<AchievementMilestoneClaim, { outcome: 'CLAIMED' }> | null = null;
  try {
    const context = await dependencies.readContext(uid, now);
    timezone = context.timezone;
    localDate = context.localDate;
    if (!context.allowed) return suppress(context.reason, { timezone, localDate });
    const policy = await dependencies.resolvePolicy(uid);
    if (!policy.allowed) return suppress(policy.reason, { timezone, localDate });
    const sample = buildWeeklyAchievementRequest(uid, context.candidate, 'pt-BR');
    const claim = await dependencies.claimMilestone(sample, now);
    if (claim.outcome !== 'CLAIMED') return suppress('MILESTONE_DUPLICATE', { timezone, localDate });
    activeClaim = claim;

    const window = await dependencies.claimProductWindow({ uid, localDate: context.localDate, request: sample }, now);
    if (window.outcome !== 'CLAIMED') {
      await dependencies.releaseMilestone(claim);
      activeClaim = null;
      return suppress(window.outcome === 'RATE_LIMITED' ? 'PRODUCT_RATE_LIMIT' : 'DAILY_DUPLICATE', {
        timezone, localDate,
      });
    }

    const outcome = await dependencies.dispatchCandidate({
      uid,
      category: 'EVOLUTION_AND_ACHIEVEMENTS',
      build: (locale) => buildWeeklyAchievementRequest(uid, context.candidate, locale),
    });
    const milestoneCompletion = dependencies.completeMilestone({
      milestoneId: claim.milestoneId,
      claimToken: claim.claimToken,
      outcome: outcome.status,
    }, now);
    if (outcome.status === 'SUPPRESSED_BY_PREFERENCE' || outcome.status === 'SUPPRESSED_BY_POLICY') {
      await Promise.all([
        milestoneCompletion,
        dependencies.releaseProductWindow({ windowId: window.windowId, claimToken: window.claimToken }),
      ]);
      activeClaim = null;
      return suppress(outcome.status, { timezone, localDate });
    }
    await Promise.all([
      milestoneCompletion,
      dependencies.completeProductWindow({
        windowId: window.windowId,
        claimToken: window.claimToken,
        outcome: outcome.status,
      }, now),
    ]);
    activeClaim = null;
    logInfo(SCOPE, 'candidate_outcome', {
      notificationType: context.candidate.notificationType,
      weekStart: context.candidate.week.weekStart,
      streakWeeks: context.candidate.notificationType === 'WEEK_STREAK' ? context.candidate.weeks : undefined,
      outcome: outcome.status,
    });
    return {
      status: 'DISPATCHED',
      notificationType: context.candidate.notificationType,
      timezone: context.timezone,
      localDate: context.localDate,
      outcome: outcome.status,
    };
  } catch (error) {
    if (activeClaim) await dependencies.releaseMilestone(activeClaim).catch(() => false);
    logFunctionError(SCOPE, error, { operation: 'evaluate', timezone, localDate });
    return { status: 'FAILED', timezone, localDate };
  }
}
