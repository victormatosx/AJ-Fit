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
  buildReEngagementEarlyNotification,
  buildReEngagementLateNotification,
} from './contentPolicy';
import {
  claimDailyProductWindow,
  completeDailyProductWindow,
  releaseDailyProductWindowClaim,
  type DailyProductWindowClaim,
} from './dailyProductRateLimit';
import { resolveUserNotificationPolicy } from './preferences';
import {
  readReEngagementContext,
  type ReEngagementContext,
} from './reengagementContext';
import type { NotificationDispatchOutcome, NotificationDispatchRequest } from './schema';
import { dispatchUserNotificationCandidate } from './userNotificationDispatch';

const SCOPE = 'notifications.reengagement';

export type ReEngagementEvaluation =
  | {
      status: 'DISPATCHED';
      notificationType: 'RE_ENGAGEMENT_EARLY' | 'RE_ENGAGEMENT_LATE';
      timezone: string;
      localDate: string;
      outcome: NotificationDispatchOutcome['status'];
      blocksLowerPriorityNotifications: true;
    }
  | {
      status: 'SUPPRESSED';
      reason: string;
      timezone?: string;
      localDate?: string;
      blocksLowerPriorityNotifications: boolean;
    }
  | {
      status: 'FAILED';
      timezone?: string;
      localDate?: string;
      blocksLowerPriorityNotifications: true;
    };

export interface ReEngagementDependencies {
  now(): Timestamp;
  readContext(uid: string, now: Timestamp): Promise<ReEngagementContext>;
  claimMilestone(request: NotificationDispatchRequest, now: Timestamp): Promise<AchievementMilestoneClaim>;
  completeMilestone(input: {
    milestoneId: string;
    claimToken: string;
    outcome: string;
  }, now: Timestamp): Promise<boolean>;
  releaseMilestone(input: { milestoneId: string; claimToken: string }): Promise<boolean>;
  claimProductWindow(input: {
    uid: string;
    localDate: string;
    request: NotificationDispatchRequest;
  }, now: Timestamp): Promise<DailyProductWindowClaim>;
  completeProductWindow(input: {
    windowId: string;
    claimToken: string;
    outcome: string;
  }, now: Timestamp): Promise<boolean>;
  releaseProductWindow(input: { windowId: string; claimToken: string }): Promise<boolean>;
  resolvePolicy(uid: string): Promise<{ allowed: boolean; reason: string }>;
  dispatchCandidate: typeof dispatchUserNotificationCandidate;
}

function defaultDependencies(): ReEngagementDependencies {
  return {
    now: Timestamp.now,
    readContext: (uid, now) => readReEngagementContext(defaultDb, uid, now),
    claimMilestone: (request, now) => claimAchievementMilestone(defaultDb, request, now),
    completeMilestone: (input, now) => completeAchievementMilestone(defaultDb, input, now),
    releaseMilestone: (input) => releaseAchievementMilestoneClaim(defaultDb, input),
    claimProductWindow: (input, now) => claimDailyProductWindow(defaultDb, input, now),
    completeProductWindow: (input, now) => completeDailyProductWindow(defaultDb, input, now),
    releaseProductWindow: (input) => releaseDailyProductWindowClaim(defaultDb, input),
    resolvePolicy: (uid) => resolveUserNotificationPolicy({
      uid,
      category: 'WORKOUTS_AND_REMINDERS',
    }, defaultDb),
    dispatchCandidate: dispatchUserNotificationCandidate,
  };
}

function buildRequest(
  uid: string,
  context: Extract<ReEngagementContext, { allowed: true }>,
  locale: 'pt-BR' | 'en' | 'es',
): NotificationDispatchRequest {
  const params = { uid, episodeIdentity: context.episodeIdentity, locale };
  return context.notificationType === 'RE_ENGAGEMENT_LATE'
    ? buildReEngagementLateNotification(params)
    : buildReEngagementEarlyNotification(params);
}

function suppress(
  reason: string,
  blocksLowerPriorityNotifications: boolean,
  input: { timezone?: string; localDate?: string } = {},
): ReEngagementEvaluation {
  logInfo(SCOPE, 'candidate_suppressed', { reason, ...input });
  return { status: 'SUPPRESSED', reason, blocksLowerPriorityNotifications, ...input };
}

export async function evaluateReEngagementNotification(
  uid: string,
  dependencies: ReEngagementDependencies = defaultDependencies(),
): Promise<ReEngagementEvaluation> {
  const now = dependencies.now();
  let timezone: string | undefined;
  let localDate: string | undefined;
  let milestoneClaim: Extract<AchievementMilestoneClaim, { outcome: 'CLAIMED' }> | null = null;
  try {
    const context = await dependencies.readContext(uid, now);
    timezone = context.timezone;
    localDate = context.localDate;
    if (!context.allowed) return suppress(context.reason, false, { timezone, localDate });

    const policy = await dependencies.resolvePolicy(uid);
    if (!policy.allowed) return suppress(policy.reason, false, { timezone, localDate });

    const sample = buildRequest(uid, context, 'pt-BR');
    const claim = await dependencies.claimMilestone(sample, now);
    if (claim.outcome !== 'CLAIMED') {
      return suppress('MILESTONE_DUPLICATE', true, { timezone, localDate });
    }
    milestoneClaim = claim;

    const productWindow = await dependencies.claimProductWindow({
      uid,
      localDate: context.localDate,
      request: sample,
    }, now);
    if (productWindow.outcome !== 'CLAIMED') {
      await dependencies.releaseMilestone(claim);
      milestoneClaim = null;
      return suppress(
        productWindow.outcome === 'RATE_LIMITED' ? 'PRODUCT_RATE_LIMIT' : 'DAILY_DUPLICATE',
        true,
        { timezone, localDate },
      );
    }

    const outcome = await dependencies.dispatchCandidate({
      uid,
      category: 'WORKOUTS_AND_REMINDERS',
      build: (locale) => buildRequest(uid, context, locale),
    });
    if (outcome.status === 'SUPPRESSED_BY_PREFERENCE' || outcome.status === 'SUPPRESSED_BY_POLICY') {
      await Promise.all([
        dependencies.completeMilestone({
          milestoneId: claim.milestoneId,
          claimToken: claim.claimToken,
          outcome: outcome.status,
        }, now),
        dependencies.releaseProductWindow({
          windowId: productWindow.windowId,
          claimToken: productWindow.claimToken,
        }),
      ]);
      milestoneClaim = null;
      return suppress(outcome.status, false, { timezone, localDate });
    }
    await Promise.all([
      dependencies.completeMilestone({
        milestoneId: claim.milestoneId,
        claimToken: claim.claimToken,
        outcome: outcome.status,
      }, now),
      dependencies.completeProductWindow({
        windowId: productWindow.windowId,
        claimToken: productWindow.claimToken,
        outcome: outcome.status,
      }, now),
    ]);
    milestoneClaim = null;
    logInfo(SCOPE, 'candidate_outcome', {
      notificationType: sample.type,
      missedOpportunityCount: context.missedOpportunityCount,
      sourceEventHash: sample.sourceIdentity.split(':').at(-1),
      outcome: outcome.status,
    });
    return {
      status: 'DISPATCHED',
      notificationType: context.notificationType,
      timezone: context.timezone,
      localDate: context.localDate,
      outcome: outcome.status,
      blocksLowerPriorityNotifications: true,
    };
  } catch (error) {
    if (milestoneClaim) {
      await dependencies.releaseMilestone(milestoneClaim).catch(() => false);
    }
    logFunctionError(SCOPE, error, { operation: 'evaluate', timezone, localDate });
    return { status: 'FAILED', timezone, localDate, blocksLowerPriorityNotifications: true };
  }
}
