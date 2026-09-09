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
  buildAssessmentReminderNotification,
  buildCompareProgressNotification,
  buildPhotoReminderNotification,
  type NotificationLocale,
} from './contentPolicy';
import {
  claimDailyProductWindow,
  completeDailyProductWindow,
  releaseDailyProductWindowClaim,
  type DailyProductWindowClaim,
} from './dailyProductRateLimit';
import { resolveUserNotificationPolicy } from './preferences';
import {
  readProgressNotificationContext,
  type ProgressCandidate,
  type ProgressNotificationContext,
} from './progressNotificationContext';
import type { NotificationDispatchOutcome, NotificationDispatchRequest } from './schema';
import { dispatchUserNotificationCandidate } from './userNotificationDispatch';

const SCOPE = 'notifications.progress';

export type ProgressNotificationEvaluation = {
  status: 'DISPATCHED';
  notificationType: ProgressCandidate['notificationType'];
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

export interface ProgressNotificationDependencies {
  now(): Timestamp;
  readContext(uid: string, now: Timestamp): Promise<ProgressNotificationContext>;
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

function defaultDependencies(): ProgressNotificationDependencies {
  return {
    now: Timestamp.now,
    readContext: (uid, now) => readProgressNotificationContext(defaultDb, uid, now),
    claimMilestone: (request, now) => claimAchievementMilestone(defaultDb, request, now),
    completeMilestone: (input, now) => completeAchievementMilestone(defaultDb, input, now),
    releaseMilestone: (input) => releaseAchievementMilestoneClaim(defaultDb, input),
    claimProductWindow: (input, now) => claimDailyProductWindow(defaultDb, input, now),
    completeProductWindow: (input, now) => completeDailyProductWindow(defaultDb, input, now),
    releaseProductWindow: (input) => releaseDailyProductWindowClaim(defaultDb, input),
    resolvePolicy: (uid) => resolveUserNotificationPolicy({ uid, category: 'PROGRESS' }, defaultDb),
    dispatchCandidate: dispatchUserNotificationCandidate,
  };
}

export function buildProgressRequest(
  uid: string,
  candidate: ProgressCandidate,
  locale: NotificationLocale,
): NotificationDispatchRequest {
  const params = { uid, progressIdentity: candidate.progressIdentity, locale };
  switch (candidate.notificationType) {
    case 'COMPARE_PROGRESS': return buildCompareProgressNotification(params);
    case 'ASSESSMENT_REMINDER': return buildAssessmentReminderNotification(params);
    case 'PHOTO_REMINDER': return buildPhotoReminderNotification(params);
  }
}

function suppress(
  reason: string,
  input: { timezone?: string; localDate?: string } = {},
): ProgressNotificationEvaluation {
  logInfo(SCOPE, 'candidate_suppressed', { reason, ...input });
  return { status: 'SUPPRESSED', reason, ...input };
}

export async function evaluateProgressNotification(
  uid: string,
  dependencies: ProgressNotificationDependencies = defaultDependencies(),
): Promise<ProgressNotificationEvaluation> {
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

    for (const candidate of context.candidates) {
      const sample = buildProgressRequest(uid, candidate, 'pt-BR');
      const claim = await dependencies.claimMilestone(sample, now);
      if (claim.outcome !== 'CLAIMED') continue;
      activeClaim = claim;

      const productWindow = await dependencies.claimProductWindow({
        uid,
        localDate: context.localDate,
        request: sample,
      }, now);
      if (productWindow.outcome !== 'CLAIMED') {
        await dependencies.releaseMilestone(claim);
        activeClaim = null;
        return suppress(
          productWindow.outcome === 'RATE_LIMITED' ? 'PRODUCT_RATE_LIMIT' : 'DAILY_DUPLICATE',
          { timezone, localDate },
        );
      }

      const outcome = await dependencies.dispatchCandidate({
        uid,
        category: 'PROGRESS',
        build: (locale) => buildProgressRequest(uid, candidate, locale),
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
        activeClaim = null;
        return suppress(outcome.status, { timezone, localDate });
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
      activeClaim = null;
      logInfo(SCOPE, 'candidate_outcome', {
        notificationType: candidate.notificationType,
        sourceEventHash: sample.sourceIdentity.split(':').at(-1),
        outcome: outcome.status,
      });
      return {
        status: 'DISPATCHED',
        notificationType: candidate.notificationType,
        timezone: context.timezone,
        localDate: context.localDate,
        outcome: outcome.status,
      };
    }
    return suppress('MILESTONE_DUPLICATE', { timezone, localDate });
  } catch (error) {
    if (activeClaim) await dependencies.releaseMilestone(activeClaim).catch(() => false);
    logFunctionError(SCOPE, error, { operation: 'evaluate', timezone, localDate });
    return { status: 'FAILED', timezone, localDate };
  }
}
