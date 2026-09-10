import type { Timestamp } from 'firebase-admin/firestore';

import { logInfo } from '../lib/logger';
import {
  assertValidDispatchRequest,
  type NotificationLocale,
} from './contentPolicy';
import {
  defaultDependencies,
  dispatchNotification,
  type DispatcherDependencies,
} from './dispatcher';
import { claimDispatch, markDispatchOutcome } from './idempotency';
import {
  resolveNotificationEligibility,
  resolveUserNotificationPolicy,
  type NotificationEligibilityResult,
} from './preferences';
import type {
  NotificationCategory,
  NotificationDispatchOutcome,
  NotificationDispatchRequest,
} from './schema';

const SCOPE = 'notifications.policy';

async function dispatchWithEligibility(
  request: NotificationDispatchRequest,
  eligibility: NotificationEligibilityResult,
  dependencies: DispatcherDependencies = defaultDependencies(),
): Promise<NotificationDispatchOutcome> {
  assertValidDispatchRequest(request);
  if (eligibility.allowed) return dispatchNotification(request, dependencies);

  const now: Timestamp = dependencies.now();
  const claim = await claimDispatch(dependencies.db, request, now);
  if (
    claim.outcome === 'DUPLICATE_IN_PROGRESS' ||
    claim.outcome === 'DUPLICATE_TERMINAL' ||
    !claim.claimToken
  ) {
    logInfo(SCOPE, 'dispatch_deduplicated', {
      dispatchId: claim.dispatchId,
      type: request.type,
      outcome: claim.outcome,
    });
    return { status: 'DUPLICATE', dispatchId: claim.dispatchId };
  }

  const written = await markDispatchOutcome(
    dependencies.db,
    claim.dispatchId,
    claim.claimToken,
    {
      status: 'SUPPRESSED_BY_PREFERENCE',
      terminalReason: eligibility.reason,
    },
    now,
  );
  if (!written) return { status: 'DUPLICATE', dispatchId: claim.dispatchId };

  logInfo(SCOPE, 'candidate_suppressed', {
    dispatchId: claim.dispatchId,
    notificationType: request.type,
    category: request.category,
    reason: eligibility.reason,
  });
  return { status: 'SUPPRESSED_BY_PREFERENCE', dispatchId: claim.dispatchId };
}

export async function dispatchUserNotification(
  request: NotificationDispatchRequest,
  dependencies: DispatcherDependencies = defaultDependencies(),
): Promise<NotificationDispatchOutcome> {
  const eligibility = await resolveNotificationEligibility(
    { uid: request.uid, category: request.category },
    dependencies.db,
  );
  return dispatchWithEligibility(request, eligibility, dependencies);
}

export async function dispatchUserNotificationCandidate(
  candidate: {
    uid: string;
    category: NotificationCategory;
    build(locale: NotificationLocale): NotificationDispatchRequest;
  },
  dependencies: DispatcherDependencies = defaultDependencies(),
): Promise<NotificationDispatchOutcome> {
  const policy = await resolveUserNotificationPolicy(
    { uid: candidate.uid, category: candidate.category },
    dependencies.db,
  );
  const request = candidate.build(policy.locale);
  if (request.uid !== candidate.uid || request.category !== candidate.category) {
    throw new Error('notification_candidate_contract_mismatch');
  }
  logInfo(SCOPE, 'candidate_created', {
    notificationType: request.type,
    category: request.category,
    sourceEventHash: request.sourceIdentity.split(':').at(-1),
  });
  logInfo(SCOPE, 'dispatch_requested', {
    notificationType: request.type,
    category: request.category,
    sourceEventHash: request.sourceIdentity.split(':').at(-1),
  });
  const outcome = await dispatchWithEligibility(request, policy, dependencies);
  logInfo(SCOPE, outcome.status === 'DUPLICATE' ? 'candidate_deduplicated' : 'candidate_outcome', {
    notificationType: request.type,
    category: request.category,
    outcome: outcome.status,
    dispatchId: outcome.dispatchId,
  });
  return outcome;
}
