import type { Timestamp } from 'firebase-admin/firestore';

import { logInfo } from '../lib/logger';
import { assertValidDispatchRequest } from './contentPolicy';
import {
  defaultDependencies,
  dispatchNotification,
  type DispatcherDependencies,
} from './dispatcher';
import { claimDispatch, markDispatchOutcome } from './idempotency';
import { resolveNotificationEligibility } from './preferences';
import type {
  NotificationDispatchOutcome,
  NotificationDispatchRequest,
} from './schema';

const SCOPE = 'notifications.policy';

export async function dispatchUserNotification(
  request: NotificationDispatchRequest,
  dependencies: DispatcherDependencies = defaultDependencies(),
): Promise<NotificationDispatchOutcome> {
  assertValidDispatchRequest(request);
  const eligibility = await resolveNotificationEligibility(
    { uid: request.uid, category: request.category },
    dependencies.db,
  );
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

  logInfo(SCOPE, 'dispatch_suppressed', {
    dispatchId: claim.dispatchId,
    category: request.category,
    reason: eligibility.reason,
  });
  return { status: 'SUPPRESSED_BY_PREFERENCE', dispatchId: claim.dispatchId };
}
