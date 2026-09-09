import { describe, expect, it } from 'vitest';

import { buildQaPreviewNotification, buildWorkoutDayNotification } from '../contentPolicy';
import {
  contractHashFor,
  dispatchIdFor,
  persistedDispatchRequest,
} from '../idempotency';
import type { NotificationDispatchRequest } from '../schema';

function persisted(request: NotificationDispatchRequest, mode?: 'PRODUCT' | 'QA_PREVIEW') {
  const id = dispatchIdFor(request.idempotencyKey);
  return {
    id,
    value: {
      idempotencyKeyHash: id,
      ...(mode ? { dispatchMode: mode } : {}),
      contractHash: contractHashFor(request, mode ?? 'PRODUCT'),
      request: {
        ...request,
        intent: request.intent ?? null,
        data: request.data ?? {},
      },
    },
  };
}

describe('QA dispatch idempotency persistence', () => {
  it('restores QA_PREVIEW mode so scheduled retries remain in the QA namespace', () => {
    const request = buildQaPreviewNotification({
      uid: 'admin-uid',
      type: 'EVOLUTION_APPROACHING',
      qaRequestId: '10000000-0000-4000-8000-000000000001',
      locale: 'es',
    });
    const stored = persisted(request, 'QA_PREVIEW');
    expect(persistedDispatchRequest(stored.value, stored.id)).toEqual({
      request,
      dispatchMode: 'QA_PREVIEW',
    });
  });

  it('keeps pre-change PRODUCT retry documents backward compatible', () => {
    const request = buildWorkoutDayNotification({
      uid: 'user-1', localDate: '2026-09-09', locale: 'pt-BR',
    });
    const stored = persisted(request);
    expect(persistedDispatchRequest(stored.value, stored.id)).toEqual({
      request,
      dispatchMode: 'PRODUCT',
    });
  });

  it('rejects a QA record whose persisted mode was removed or changed', () => {
    const request = buildQaPreviewNotification({
      uid: 'admin-uid',
      type: 'BILLING_ISSUE',
      qaRequestId: '10000000-0000-4000-8000-000000000001',
      locale: 'pt-BR',
    });
    const stored = persisted(request, 'QA_PREVIEW');
    expect(persistedDispatchRequest({ ...stored.value, dispatchMode: 'PRODUCT' }, stored.id))
      .toBeNull();
  });
});
