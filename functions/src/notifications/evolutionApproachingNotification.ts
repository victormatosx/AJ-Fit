import { Timestamp } from 'firebase-admin/firestore';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import {
  claimAchievementMilestone,
  completeAchievementMilestone,
  releaseAchievementMilestoneClaim,
  type AchievementMilestoneClaim,
} from './achievementMilestones';
import { buildEvolutionApproachingNotification } from './contentPolicy';
import {
  claimDailyProductWindow,
  completeDailyProductWindow,
  releaseDailyProductWindowClaim,
  type DailyProductWindowClaim,
} from './dailyProductRateLimit';
import {
  readApproachingContext,
  type ApproachingContext,
} from './evolutionApproachingContext';
import type { NotificationDispatchOutcome, NotificationDispatchRequest } from './schema';
import { resolveUserNotificationPolicy } from './preferences';
import { dispatchUserNotificationCandidate } from './userNotificationDispatch';

const SCOPE = 'notifications.evolutionApproaching';

export type EvolutionApproachingEvaluation =
  | {
      status: 'DISPATCHED';
      notificationType: 'EVOLUTION_APPROACHING';
      timezone: string;
      localDate: string;
      outcome: NotificationDispatchOutcome['status'];
    }
  | { status: 'SUPPRESSED'; reason: string; timezone?: string; localDate?: string }
  | { status: 'FAILED'; timezone?: string; localDate?: string };

export interface EvolutionApproachingDependencies {
  now(): Timestamp;
  readContext(uid: string, now: Timestamp): Promise<ApproachingContext>;
  claim(request: NotificationDispatchRequest, now: Timestamp): Promise<AchievementMilestoneClaim>;
  complete(input: {
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

function defaultDependencies(): EvolutionApproachingDependencies {
  return {
    now: Timestamp.now,
    readContext: (uid, now) => readApproachingContext(defaultDb, uid, now),
    claim: (request, now) => claimAchievementMilestone(defaultDb, request, now),
    complete: (input, now) => completeAchievementMilestone(defaultDb, input, now),
    releaseMilestone: (input) => releaseAchievementMilestoneClaim(defaultDb, input),
    claimProductWindow: (input, now) => claimDailyProductWindow(defaultDb, input, now),
    completeProductWindow: (input, now) => completeDailyProductWindow(defaultDb, input, now),
    releaseProductWindow: (input) => releaseDailyProductWindowClaim(defaultDb, input),
    resolvePolicy: (uid) => resolveUserNotificationPolicy({
      uid,
      category: 'EVOLUTION_AND_ACHIEVEMENTS',
    }, defaultDb),
    dispatchCandidate: dispatchUserNotificationCandidate,
  };
}

export async function evaluateEvolutionApproaching(
  uid: string,
  dependencies: EvolutionApproachingDependencies = defaultDependencies(),
): Promise<EvolutionApproachingEvaluation> {
  const now = dependencies.now();
  let timezone: string | undefined;
  let localDate: string | undefined;
  let milestoneClaim: Extract<AchievementMilestoneClaim, { outcome: 'CLAIMED' }> | null = null;
  logInfo(SCOPE, 'evolution_approaching_evaluated', {});
  try {
    const context = await dependencies.readContext(uid, now);
    timezone = context.timezone;
    localDate = context.localDate;
    if (!context.allowed) {
      logInfo(SCOPE, 'evolution_approaching_suppressed', {
        reason: context.reason,
        timezone,
        localDate,
      });
      return { status: 'SUPPRESSED', reason: context.reason, timezone, localDate };
    }
    const policy = await dependencies.resolvePolicy(uid);
    if (!policy.allowed) {
      return { status: 'SUPPRESSED', reason: policy.reason, timezone, localDate };
    }

    const sample = buildEvolutionApproachingNotification({
      uid,
      progressionWindowId: context.progressionWindowId,
      locale: 'pt-BR',
    });
    const claim = await dependencies.claim(sample, now);
    if (claim.outcome !== 'CLAIMED') {
      logInfo(SCOPE, 'dispatch_deduplicated', {
        notificationType: sample.type,
        reason: 'MILESTONE_DUPLICATE',
      });
      return {
        status: 'SUPPRESSED',
        reason: 'MILESTONE_DUPLICATE',
        timezone,
        localDate,
      };
    }

    milestoneClaim = claim;

    // EVOLUTION_APPROACHING shares the one-per-user/local-day product slot with
    // the other planned daily observers, so two concurrent scheduler workers
    // cannot land a workout candidate and this one on the same local day.
    const productWindow = await dependencies.claimProductWindow({
      uid,
      localDate: context.localDate,
      request: sample,
    }, now);
    if (productWindow.outcome !== 'CLAIMED') {
      await dependencies.releaseMilestone(claim);
      milestoneClaim = null;
      return {
        status: 'SUPPRESSED',
        reason: productWindow.outcome === 'RATE_LIMITED' ? 'PRODUCT_RATE_LIMIT' : 'DAILY_DUPLICATE',
        timezone,
        localDate,
      };
    }

    logInfo(SCOPE, 'evolution_approaching_created', {
      notificationType: sample.type,
      sourceEventHash: context.sourceIdentity.split(':').at(-1),
    });
    const outcome = await dependencies.dispatchCandidate({
      uid,
      category: 'EVOLUTION_AND_ACHIEVEMENTS',
      build: (locale) => buildEvolutionApproachingNotification({
        uid,
        progressionWindowId: context.progressionWindowId,
        locale,
      }),
    });
    const milestoneCompletion = dependencies.complete({
      milestoneId: claim.milestoneId,
      claimToken: claim.claimToken,
      outcome: outcome.status,
    }, now);
    if (outcome.status === 'SUPPRESSED_BY_PREFERENCE' || outcome.status === 'SUPPRESSED_BY_POLICY') {
      await Promise.all([
        milestoneCompletion,
        dependencies.releaseProductWindow({
          windowId: productWindow.windowId,
          claimToken: productWindow.claimToken,
        }),
      ]);
      milestoneClaim = null;
      return { status: 'SUPPRESSED', reason: outcome.status, timezone, localDate };
    }
    await Promise.all([
      milestoneCompletion,
      dependencies.completeProductWindow({
        windowId: productWindow.windowId,
        claimToken: productWindow.claimToken,
        outcome: outcome.status,
      }, now),
    ]);
    milestoneClaim = null;
    logInfo(SCOPE, 'candidate_outcome', {
      notificationType: sample.type,
      outcome: outcome.status,
      sourceEventHash: context.sourceIdentity.split(':').at(-1),
    });
    return {
      status: 'DISPATCHED',
      notificationType: 'EVOLUTION_APPROACHING',
      timezone: context.timezone,
      localDate: context.localDate,
      outcome: outcome.status,
    };
  } catch (error) {
    if (milestoneClaim) await dependencies.releaseMilestone(milestoneClaim).catch(() => false);
    logFunctionError(SCOPE, error, { operation: 'evaluate', timezone, localDate });
    return { status: 'FAILED', timezone, localDate };
  }
}
