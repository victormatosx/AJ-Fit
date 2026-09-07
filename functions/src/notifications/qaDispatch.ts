import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { requireAdminUid } from '../attribution/adminAuth';
import { buildQaTestNotification } from './contentPolicy';
import type { DispatcherDependencies } from './dispatcher';
import type { NotificationDispatchOutcome } from './schema';
import { dispatchUserNotification } from './userNotificationDispatch';

function assertEmptyInput(value: unknown): void {
  if (value === undefined || value === null) return;
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value as Record<string, unknown>).length > 0
  ) {
    throw new HttpsError('invalid-argument', 'qa_notification_accepts_no_payload');
  }
}

export function createDispatchTestNotificationHandler(
  dependencies?: DispatcherDependencies,
) {
  return async (request: CallableRequest<unknown>): Promise<NotificationDispatchOutcome> => {
    assertEmptyInput(request.data);
    const uid = await requireAdminUid(request);
    const now = dependencies?.now().toMillis() ?? Date.now();
    const bucket = Math.floor(now / (5 * 60 * 1000));
    return dispatchUserNotification(
      buildQaTestNotification({
        uid,
        notificationId: `qa-test-${bucket}`,
        sourceIdentity: `qa-probe:${uid}:${bucket}`,
        idempotencyKey: `qa-test:${uid}:${bucket}`,
      }),
      dependencies,
    );
  };
}

export const dispatchTestNotificationHandler = createDispatchTestNotificationHandler();
