import type { CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const intentMocks = vi.hoisted(() => ({ authorizePromoPurchaseTransactionally: vi.fn() }));
vi.mock('../promoPurchaseIntent', () => intentMocks);

import { authorizePromoPurchaseHandler } from '../authorizePromoPurchase';
import type { AuthorizePromoPurchaseRequestData } from '../types';

const UID = 'firebase-uid-caller';
const CREATED_AT = Timestamp.fromDate(new Date('2026-08-13T15:00:00.000Z'));
const EXPIRES_AT = Timestamp.fromDate(new Date('2026-08-13T15:10:00.000Z'));

function request(
  data: AuthorizePromoPurchaseRequestData,
  authUid: string | null = UID,
): CallableRequest<AuthorizePromoPurchaseRequestData> {
  return {
    data,
    auth: authUid === null ? undefined : { uid: authUid, token: {} as never },
    rawRequest: {} as never,
  } as unknown as CallableRequest<AuthorizePromoPurchaseRequestData>;
}

function authorizedResult(plan: 'monthly' | 'annual' = 'monthly') {
  return {
    status: 'authorized' as const,
    reused: false,
    intent: {
      campaignId: 'campaign-arnaldo',
      plan,
      expectedProductId:
        plan === 'monthly' ? 'ajfit_premium_monthly_promo' : 'ajfit_premium_annual_promo',
      offeringIdentifier: 'promo_7d',
      status: 'purchase_pending' as const,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
    },
  };
}

async function expectHttpsError(promise: Promise<unknown>, code: string, message: string) {
  await expect(promise).rejects.toMatchObject({ code, message });
}

describe('authorizePromoPurchaseHandler', () => {
  beforeEach(() => intentMocks.authorizePromoPurchaseTransactionally.mockReset());

  it('rejects unauthenticated callers before starting a transaction', async () => {
    await expectHttpsError(
      authorizePromoPurchaseHandler(request({ plan: 'monthly' }, null)),
      'unauthenticated',
      'authentication_required',
    );
    expect(intentMocks.authorizePromoPurchaseTransactionally).not.toHaveBeenCalled();
  });

  it.each([undefined, 'weekly', '', 123])('rejects invalid plan %j', async (plan) => {
    await expectHttpsError(
      authorizePromoPurchaseHandler(request({ plan })),
      'invalid-argument',
      'invalid_purchase_plan',
    );
    expect(intentMocks.authorizePromoPurchaseTransactionally).not.toHaveBeenCalled();
  });

  it.each(['uid', 'campaign', 'offeringIdentifier', 'expectedProductId', 'status', 'expiresAt'])(
    'rejects forbidden client authority field %s',
    async (field) => {
      await expectHttpsError(
        authorizePromoPurchaseHandler(
          request({ plan: 'monthly', [field]: 'attacker-value' } as AuthorizePromoPurchaseRequestData),
        ),
        'invalid-argument',
        'invalid_purchase_plan',
      );
      expect(intentMocks.authorizePromoPurchaseTransactionally).not.toHaveBeenCalled();
    },
  );

  it('uses request.auth.uid and returns only the minimal derived contract', async () => {
    intentMocks.authorizePromoPurchaseTransactionally.mockResolvedValue(authorizedResult());

    const response = await authorizePromoPurchaseHandler(request({ plan: 'monthly' }));

    expect(intentMocks.authorizePromoPurchaseTransactionally).toHaveBeenCalledWith(UID, 'monthly');
    expect(response).toEqual({
      authorized: true,
      purchaseIntent: {
        plan: 'monthly',
        offeringIdentifier: 'promo_7d',
        expectedProductId: 'ajfit_premium_monthly_promo',
        status: 'purchase_pending',
        expiresAt: '2026-08-13T15:10:00.000Z',
      },
    });
    expect(response).not.toHaveProperty('campaignId');
    expect(response).not.toHaveProperty('uid');
  });

  it.each([
    ['no_redemption', 'promo_redemption_required'],
    ['invalid_redemption', 'ios_promotion_unavailable'],
    ['ios_promotion_unavailable', 'ios_promotion_unavailable'],
    ['redemption_consumed', 'promo_redemption_consumed'],
    ['intent_conflict', 'promo_purchase_intent_conflict'],
  ] as const)('maps %s to a controlled failed-precondition', async (status, message) => {
    intentMocks.authorizePromoPurchaseTransactionally.mockResolvedValue({ status });
    await expectHttpsError(
      authorizePromoPurchaseHandler(request({ plan: 'monthly' })),
      'failed-precondition',
      message,
    );
  });
});
