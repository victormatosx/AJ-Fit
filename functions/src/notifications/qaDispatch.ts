import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { requireAdminUid } from '../attribution/adminAuth';
import {
  buildQaPreviewNotification,
  QA_PREVIEW_NOTIFICATION_TYPES,
  type QaPreviewNotificationType,
} from './contentPolicy';
import type { DispatcherDependencies } from './dispatcher';
import { dispatchNotification } from './dispatcher';
import { resolveQaPreviewNotificationPolicy } from './preferences';
import type { NotificationDispatchOutcome } from './schema';

const QA_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface QaPreviewInput {
  notificationType: QaPreviewNotificationType;
  qaRequestId: string;
}

function parseInput(value: unknown): QaPreviewInput {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value as Record<string, unknown>).sort().join(',') !==
      'notificationType,qaRequestId'
  ) {
    throw new HttpsError('invalid-argument', 'qa_notification_payload_invalid');
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.notificationType !== 'string' ||
    !(QA_PREVIEW_NOTIFICATION_TYPES as readonly string[]).includes(input.notificationType)
  ) {
    throw new HttpsError('invalid-argument', 'qa_notification_type_unsupported');
  }
  if (typeof input.qaRequestId !== 'string' || !QA_REQUEST_ID_PATTERN.test(input.qaRequestId)) {
    throw new HttpsError('invalid-argument', 'qa_request_id_invalid');
  }
  return {
    notificationType: input.notificationType as QaPreviewNotificationType,
    qaRequestId: input.qaRequestId.toLowerCase(),
  };
}

interface QaDispatchOverrides {
  authorize?(request: CallableRequest<unknown>): Promise<string>;
  resolvePolicy?: typeof resolveQaPreviewNotificationPolicy;
  dispatch?: typeof dispatchNotification;
}

export function createDispatchTestNotificationHandler(
  dependencies?: DispatcherDependencies,
  overrides: QaDispatchOverrides = {},
) {
  return async (request: CallableRequest<unknown>): Promise<NotificationDispatchOutcome> => {
    const uid = await (overrides.authorize ?? requireAdminUid)(request);
    const input = parseInput(request.data);
    const policy = await (overrides.resolvePolicy ?? resolveQaPreviewNotificationPolicy)(
      uid,
      dependencies?.db,
    );
    if (!policy.allowed) {
      throw new HttpsError('failed-precondition', `qa_notification_${policy.reason.toLowerCase()}`);
    }
    return (overrides.dispatch ?? dispatchNotification)(
      buildQaPreviewNotification({
        uid,
        type: input.notificationType,
        qaRequestId: input.qaRequestId,
        locale: policy.locale,
      }),
      dependencies,
      'QA_PREVIEW',
    );
  };
}

export const dispatchTestNotificationHandler = createDispatchTestNotificationHandler();
