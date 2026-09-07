import { describe, expect, it, vi } from 'vitest';

import type { NotificationDispatchRequest } from '../schema';
import { dispatchRevenueCatNotification } from '../revenueCatNotifications';

function accepted(dispatchId = 'dispatch-1') {
  return {
    status: 'PENDING_RECEIPTS' as const,
    dispatchId,
    deviceCount: 1,
    acceptedCount: 1,
  };
}

describe('RevenueCat operational notifications', () => {
  it('maps a real premium BILLING_ISSUE to operational copy without saying access ended', async () => {
    let request: NotificationDispatchRequest | undefined;
    const dispatchCandidate = vi.fn(async (candidate: Parameters<
      typeof import('../userNotificationDispatch').dispatchUserNotificationCandidate
    >[0]) => {
      request = candidate.build('pt-BR');
      return accepted();
    });

    await dispatchRevenueCatNotification({
      uid: 'uid-1', eventId: 'rc-billing-1', eventType: 'BILLING_ISSUE',
      concernsPremium: true, entitlementActive: true,
    }, { dispatchCandidate });

    expect(request).toMatchObject({ type: 'BILLING_ISSUE', category: 'OPERATIONAL', data: {} });
    expect(request?.body).toContain('evitar interrupções');
    expect(request?.body).not.toContain('encerrado');
    expect(request?.body).not.toContain('terminou');
  });

  it('keeps webhook replay deterministic for dispatcher idempotency', async () => {
    const requests: NotificationDispatchRequest[] = [];
    const seen = new Set<string>();
    const dispatchCandidate = vi.fn(async (candidate: Parameters<
      typeof import('../userNotificationDispatch').dispatchUserNotificationCandidate
    >[0]) => {
      const request = candidate.build('en');
      requests.push(request);
      if (seen.has(request.idempotencyKey)) {
        return { status: 'DUPLICATE' as const, dispatchId: 'same-dispatch' };
      }
      seen.add(request.idempotencyKey);
      return accepted('same-dispatch');
    });
    const input = {
      uid: 'uid-1', eventId: 'rc-billing-replay', eventType: 'BILLING_ISSUE' as const,
      concernsPremium: true, entitlementActive: true,
    };

    expect((await dispatchRevenueCatNotification(input, { dispatchCandidate })).status)
      .toBe('PENDING_RECEIPTS');
    expect((await dispatchRevenueCatNotification(input, { dispatchCandidate })).status)
      .toBe('DUPLICATE');
    expect(requests[0]?.idempotencyKey).toBe(requests[1]?.idempotencyKey);
  });

  it.each(['CANCELLATION', 'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE'] as const)(
    'never treats %s as a billing issue or ended access',
    async (eventType) => {
      const dispatchCandidate = vi.fn();
      await expect(dispatchRevenueCatNotification({
        uid: 'uid-1', eventId: `rc-${eventType}`, eventType,
        concernsPremium: true, entitlementActive: eventType === 'CANCELLATION',
      }, { dispatchCandidate })).resolves.toEqual({
        status: 'IGNORED', reason: 'EVENT_TYPE_NOT_ELIGIBLE',
      });
      expect(dispatchCandidate).not.toHaveBeenCalled();
    },
  );

  it('maps only premium EXPIRATION with inactive entitlement to PREMIUM_ENDED', async () => {
    let request: NotificationDispatchRequest | undefined;
    const dispatchCandidate = vi.fn(async (candidate: Parameters<
      typeof import('../userNotificationDispatch').dispatchUserNotificationCandidate
    >[0]) => {
      request = candidate.build('es');
      return accepted();
    });

    await dispatchRevenueCatNotification({
      uid: 'uid-1', eventId: 'rc-expiration-1', eventType: 'EXPIRATION',
      concernsPremium: true, entitlementActive: false,
    }, { dispatchCandidate });

    expect(request).toMatchObject({ type: 'PREMIUM_ENDED', category: 'OPERATIONAL', data: {} });
    expect(request?.body).not.toContain('pago');
    expect(request?.body).not.toContain('cobrança');
  });

  it('fails closed if an expiration still reports active entitlement', async () => {
    const dispatchCandidate = vi.fn();
    await expect(dispatchRevenueCatNotification({
      uid: 'uid-1', eventId: 'rc-expiration-active', eventType: 'EXPIRATION',
      concernsPremium: true, entitlementActive: true,
    }, { dispatchCandidate })).resolves.toEqual({
      status: 'IGNORED', reason: 'ENTITLEMENT_STILL_ACTIVE',
    });
    expect(dispatchCandidate).not.toHaveBeenCalled();
  });

  it('does not notify for an unrelated entitlement', async () => {
    const dispatchCandidate = vi.fn();
    await expect(dispatchRevenueCatNotification({
      uid: 'uid-1', eventId: 'rc-unrelated', eventType: 'EXPIRATION',
      concernsPremium: false, entitlementActive: false,
    }, { dispatchCandidate })).resolves.toEqual({
      status: 'IGNORED', reason: 'NON_PREMIUM_ENTITLEMENT',
    });
    expect(dispatchCandidate).not.toHaveBeenCalled();
  });

  it('keeps billing issue and later expiration as distinct facts', async () => {
    const requests: NotificationDispatchRequest[] = [];
    const dispatchCandidate = vi.fn(async (candidate: Parameters<
      typeof import('../userNotificationDispatch').dispatchUserNotificationCandidate
    >[0]) => {
      requests.push(candidate.build('pt-BR'));
      return accepted(`dispatch-${requests.length}`);
    });
    await dispatchRevenueCatNotification({
      uid: 'uid-1', eventId: 'rc-billing-before-expiry', eventType: 'BILLING_ISSUE',
      concernsPremium: true, entitlementActive: true,
    }, { dispatchCandidate });
    await dispatchRevenueCatNotification({
      uid: 'uid-1', eventId: 'rc-real-expiry', eventType: 'EXPIRATION',
      concernsPremium: true, entitlementActive: false,
    }, { dispatchCandidate });

    expect(requests.map((request) => request.type)).toEqual(['BILLING_ISSUE', 'PREMIUM_ENDED']);
    expect(requests[0]?.idempotencyKey).not.toBe(requests[1]?.idempotencyKey);
  });

  it('notifies only at expiration after an earlier cancellation', async () => {
    const requests: NotificationDispatchRequest[] = [];
    const dispatchCandidate = vi.fn(async (candidate: Parameters<
      typeof import('../userNotificationDispatch').dispatchUserNotificationCandidate
    >[0]) => {
      requests.push(candidate.build('pt-BR'));
      return accepted();
    });

    await dispatchRevenueCatNotification({
      uid: 'uid-1', eventId: 'rc-cancel-first', eventType: 'CANCELLATION',
      concernsPremium: true, entitlementActive: true,
    }, { dispatchCandidate });
    await dispatchRevenueCatNotification({
      uid: 'uid-1', eventId: 'rc-expire-later', eventType: 'EXPIRATION',
      concernsPremium: true, entitlementActive: false,
    }, { dispatchCandidate });

    expect(dispatchCandidate).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.type).toBe('PREMIUM_ENDED');
  });

  it.each([
    { outcome: { status: 'SUPPRESSED_BY_PREFERENCE' as const, dispatchId: 'suppressed' } },
    { outcome: { status: 'NO_ELIGIBLE_DEVICE' as const, dispatchId: 'no-device' } },
  ])('preserves a normal operational outcome: $outcome.status', async ({ outcome }) => {
    const dispatchCandidate = vi.fn(async () => outcome);
    await expect(dispatchRevenueCatNotification({
      uid: 'uid-1', eventId: 'rc-billing-outcome', eventType: 'BILLING_ISSUE',
      concernsPremium: true, entitlementActive: true,
    }, { dispatchCandidate })).resolves.toEqual(outcome);
  });

  it('absorbs dispatcher failures after subscription state is resolved', async () => {
    const dispatchCandidate = vi.fn(async () => { throw new Error('dispatcher unavailable'); });
    await expect(dispatchRevenueCatNotification({
      uid: 'uid-1', eventId: 'rc-billing-failure', eventType: 'BILLING_ISSUE',
      concernsPremium: true, entitlementActive: true,
    }, { dispatchCandidate })).resolves.toEqual({ status: 'FAILED' });
  });
});
