import type { CallableRequest } from 'firebase-functions/v2/https';
import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QA_PREVIEW_NOTIFICATION_TYPES } from '../contentPolicy';
import { createDispatchTestNotificationHandler } from '../qaDispatch';
import type { QaPreviewNotificationPolicyResult } from '../preferences';
import type {
  NotificationDispatchMode,
  NotificationDispatchOutcome,
  NotificationDispatchRequest,
} from '../schema';
import type { DispatcherDependencies } from '../dispatcher';

const ADMIN_UID = 'admin-uid';
const REQUEST_ID = '10000000-0000-4000-8000-000000000001';

function request(data: unknown, uid: string | null = ADMIN_UID): CallableRequest<unknown> {
  return {
    data,
    auth: uid ? { uid, token: {} as never } : undefined,
    rawRequest: {} as never,
  } as CallableRequest<unknown>;
}

function fixture() {
  const authorize = vi.fn(async (value: CallableRequest<unknown>) => {
    if (!value.auth?.uid) throw new HttpsError('unauthenticated', 'authentication_required');
    if (value.auth.uid !== ADMIN_UID) throw new HttpsError('permission-denied', 'admin_role_required');
    return value.auth.uid;
  });
  const resolvePolicy = vi.fn(async (): Promise<QaPreviewNotificationPolicyResult> => ({
    allowed: true as const, reason: 'ALLOWED' as const, locale: 'en' as const,
  }));
  const dispatch = vi.fn(async (
    _dispatchRequest: NotificationDispatchRequest,
    _dependencies?: DispatcherDependencies,
    _mode?: NotificationDispatchMode,
  ): Promise<NotificationDispatchOutcome> => ({
    status: 'PENDING_RECEIPTS' as const,
    dispatchId: 'dispatch-1',
    deviceCount: 1,
    acceptedCount: 1,
  }));
  const dependencies = {
    db: {} as never,
    expoClient: {} as never,
    now: () => Timestamp.fromMillis(2_000_000_000_000),
  };
  const handler = createDispatchTestNotificationHandler(dependencies, {
    authorize, resolvePolicy: resolvePolicy as never, dispatch: dispatch as never,
  });
  return { handler, authorize, resolvePolicy, dispatch, dependencies };
}

beforeEach(() => vi.clearAllMocks());

describe('dispatchTestNotification QA preview', () => {
  it('rejects unauthenticated and unauthorized authenticated callers', async () => {
    const { handler, dispatch } = fixture();
    await expect(handler(request({ notificationType: 'QA_TEST', qaRequestId: REQUEST_ID }, null)))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(handler(request({ notificationType: 'QA_TEST', qaRequestId: REQUEST_ID }, 'user')))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(QA_PREVIEW_NOTIFICATION_TYPES)('allows authorized self-targeted %s via QA_PREVIEW dispatcher mode', async (notificationType) => {
    const { handler, dispatch, dependencies } = fixture();
    await expect(handler(request({ notificationType, qaRequestId: REQUEST_ID })))
      .resolves.toMatchObject({ status: 'PENDING_RECEIPTS' });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: ADMIN_UID,
        type: notificationType,
        idempotencyKey: expect.stringContaining(`qa-preview:${ADMIN_UID}:${notificationType}:`),
      }),
      dependencies,
      'QA_PREVIEW',
    );
  });

  it.each([
    { notificationType: 'GOAL_PROXIMITY', qaRequestId: REQUEST_ID },
    { notificationType: 'NOT_IMPLEMENTED', qaRequestId: REQUEST_ID },
  ])('rejects unsupported/not implemented type %#', async (data) => {
    const { handler, dispatch } = fixture();
    await expect(handler(request(data))).rejects.toMatchObject({
      code: 'invalid-argument', message: 'qa_notification_type_unsupported',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    { notificationType: 'QA_TEST', qaRequestId: REQUEST_ID, targetUid: 'victim' },
    { notificationType: 'QA_TEST', qaRequestId: REQUEST_ID, title: 'arbitrary' },
    { notificationType: 'QA_TEST', qaRequestId: REQUEST_ID, body: 'arbitrary' },
    { notificationType: 'QA_TEST', qaRequestId: REQUEST_ID, expoPushToken: 'secret' },
  ])('rejects every extra client field, including target/copy/token %#', async (data) => {
    const { handler, dispatch } = fixture();
    await expect(handler(request(data))).rejects.toMatchObject({
      code: 'invalid-argument', message: 'qa_notification_payload_invalid',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('uses only request.auth.uid and preserves token privacy', async () => {
    const { handler, dispatch } = fixture();
    await handler(request({ notificationType: 'BILLING_ISSUE', qaRequestId: REQUEST_ID }));
    const dispatchRequest = dispatch.mock.calls[0]![0];
    expect(dispatchRequest.uid).toBe(ADMIN_UID);
    expect(JSON.stringify(dispatchRequest)).not.toMatch(/token|email|weight|measurement/i);
  });

  it('resolves the backend locale and rejects inactive accounts before dispatch', async () => {
    const allowed = fixture();
    await allowed.handler(request({ notificationType: 'PROGRAM_UPDATED', qaRequestId: REQUEST_ID }));
    expect(allowed.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Your workout was updated' }),
      expect.anything(),
      'QA_PREVIEW',
    );

    const inactive = fixture();
    inactive.resolvePolicy.mockResolvedValue({
      allowed: false, reason: 'ACCOUNT_INACTIVE', locale: 'pt-BR',
    });
    await expect(inactive.handler(request({ notificationType: 'QA_TEST', qaRequestId: REQUEST_ID })))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(inactive.dispatch).not.toHaveBeenCalled();
  });

  it('keeps retries of one click stable and distinct clicks independent', async () => {
    const { handler, dispatch } = fixture();
    const payload = { notificationType: 'EVOLUTION_UNLOCKED' as const, qaRequestId: REQUEST_ID };
    await handler(request(payload));
    await handler(request(payload));
    await handler(request({ ...payload, qaRequestId: '10000000-0000-4000-8000-000000000002' }));
    const keys = dispatch.mock.calls.map((call) => call[0].idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
