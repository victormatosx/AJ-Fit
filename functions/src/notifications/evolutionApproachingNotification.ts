import { Timestamp } from 'firebase-admin/firestore';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import {
  claimAchievementMilestone,
  completeAchievementMilestone,
  type AchievementMilestoneClaim,
} from './achievementMilestones';
import { buildEvolutionApproachingNotification } from './contentPolicy';
import {
  readApproachingContext,
  type ApproachingContext,
} from './evolutionApproachingContext';
import type { NotificationDispatchOutcome, NotificationDispatchRequest } from './schema';
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
  dispatchCandidate: typeof dispatchUserNotificationCandidate;
}

function defaultDependencies(): EvolutionApproachingDependencies {
  return {
    now: Timestamp.now,
    readContext: (uid, now) => readApproachingContext(defaultDb, uid, now),
    claim: (request, now) => claimAchievementMilestone(defaultDb, request, now),
    complete: (input, now) => completeAchievementMilestone(defaultDb, input, now),
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
    await dependencies.complete({
      milestoneId: claim.milestoneId,
      claimToken: claim.claimToken,
      outcome: outcome.status,
    }, now);
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
    logFunctionError(SCOPE, error, { operation: 'evaluate', timezone, localDate });
    return { status: 'FAILED', timezone, localDate };
  }
}
