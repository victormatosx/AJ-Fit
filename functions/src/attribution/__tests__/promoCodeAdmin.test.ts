import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userGetMock = vi.hoisted(() => vi.fn());
const promoCreateMock = vi.hoisted(() => vi.fn());
const promoUpdateMock = vi.hoisted(() => vi.fn());
const collectionGetMock = vi.hoisted(() => vi.fn());

const docMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    if (path.startsWith('users/')) return { get: userGetMock };
    return { create: promoCreateMock, update: promoUpdateMock };
  }),
);
const collectionMock = vi.hoisted(() => vi.fn((_name: string) => ({ get: collectionGetMock })));

vi.mock('../../lib/firebaseAdmin', () => ({
  db: { doc: docMock, collection: collectionMock },
  auth: {},
}));

import {
  adminCreatePromoCodeHandler,
  adminListPromoCodesHandler,
  adminSetPromoCodeActiveHandler,
  adminUpdatePromoCodeHandler,
} from '../promoCodeAdmin';

const ADMIN_UID = 'admin-uid-1';
const USER_UID = 'regular-user-uid';

function request<T>(data: T, authUid: string | null): CallableRequest<T> {
  return {
    data,
    auth: authUid !== null ? { uid: authUid, token: {} as never } : undefined,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

function mockUserRole(role: string | undefined) {
  userGetMock.mockResolvedValue({
    exists: role !== undefined,
    data: () => (role !== undefined ? { metadata: { role } } : undefined),
  });
}

async function expectHttpsError(promise: Promise<unknown>, code: string, message?: string) {
  if (message) {
    await expect(promise).rejects.toMatchObject({ code, message });
  } else {
    await expect(promise).rejects.toMatchObject({ code });
  }
}

const BASE_CREATE_PAYLOAD = {
  code: 'ARNALDO',
  campaignId: 'influencer-arnaldo-7d',
  influencerId: 'ARNALDO',
  active: true,
  startsAt: null,
  endsAt: null,
  notes: null,
};

beforeEach(() => {
  userGetMock.mockReset();
  promoCreateMock.mockReset();
  promoUpdateMock.mockReset();
  collectionGetMock.mockReset();
  docMock.mockClear();
  collectionMock.mockClear();
  mockUserRole('admin');
});

describe('admin auth enforcement (create/update/setActive/list)', () => {
  it('rejects an unauthenticated caller before touching Firestore for every handler', async () => {
    await expectHttpsError(
      adminCreatePromoCodeHandler(request(BASE_CREATE_PAYLOAD, null)),
      'unauthenticated',
      'authentication_required',
    );
    await expectHttpsError(
      adminUpdatePromoCodeHandler(request({ ...BASE_CREATE_PAYLOAD }, null)),
      'unauthenticated',
      'authentication_required',
    );
    await expectHttpsError(
      adminSetPromoCodeActiveHandler(request({ code: 'ARNALDO', active: false }, null)),
      'unauthenticated',
      'authentication_required',
    );
    await expectHttpsError(adminListPromoCodesHandler(request({}, null)), 'unauthenticated', 'authentication_required');

    expect(userGetMock).not.toHaveBeenCalled();
    expect(promoCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an authenticated caller without users/{uid}.metadata.role === "admin"', async () => {
    mockUserRole('user');
    await expectHttpsError(
      adminCreatePromoCodeHandler(request(BASE_CREATE_PAYLOAD, USER_UID)),
      'permission-denied',
      'admin_role_required',
    );
    expect(promoCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an authenticated caller whose users/{uid} document does not exist', async () => {
    mockUserRole(undefined);
    await expectHttpsError(
      adminCreatePromoCodeHandler(request(BASE_CREATE_PAYLOAD, USER_UID)),
      'permission-denied',
      'admin_role_required',
    );
  });

  it('never trusts a role claimed in the request payload — only the server-side users/{uid} read', async () => {
    mockUserRole('user');
    await expectHttpsError(
      adminCreatePromoCodeHandler(
        request({ ...BASE_CREATE_PAYLOAD, role: 'admin' } as never, USER_UID),
      ),
      'permission-denied',
      'admin_role_required',
    );
  });

  it('allows an authenticated admin through to Firestore', async () => {
    promoCreateMock.mockResolvedValue(undefined);
    const result = await adminCreatePromoCodeHandler(request(BASE_CREATE_PAYLOAD, ADMIN_UID));
    expect(result.code).toBe('ARNALDO');
    expect(promoCreateMock).toHaveBeenCalledTimes(1);
  });
});

describe('adminCreatePromoCodeHandler', () => {
  it('creates with only basic info — android/apple fields default to null', async () => {
    promoCreateMock.mockResolvedValue(undefined);
    await adminCreatePromoCodeHandler(request(BASE_CREATE_PAYLOAD, ADMIN_UID));

    expect(promoCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ARNALDO',
        campaignId: 'influencer-arnaldo-7d',
        influencerId: 'ARNALDO',
        active: true,
        androidBasePlanIdMonthly: null,
        androidOfferIdMonthly: null,
        androidBasePlanIdAnnual: null,
        androidOfferIdAnnual: null,
        appleOfferCodeMonthly: null,
        appleOfferCodeAnnual: null,
        appleProductIdMonthly: null,
        appleOfferReferenceMonthly: null,
        appleProductIdAnnual: null,
        appleOfferReferenceAnnual: null,
        notes: null,
      }),
    );
  });

  it('creates with Android monthly configured', async () => {
    promoCreateMock.mockResolvedValue(undefined);
    await adminCreatePromoCodeHandler(
      request(
        {
          ...BASE_CREATE_PAYLOAD,
          android: { monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' } },
        },
        ADMIN_UID,
      ),
    );

    expect(promoCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        androidBasePlanIdMonthly: 'monthly',
        androidOfferIdMonthly: 'influencer-trial-7d',
        androidBasePlanIdAnnual: null,
        androidOfferIdAnnual: null,
      }),
    );
  });

  it('creates with Android monthly + annual configured', async () => {
    promoCreateMock.mockResolvedValue(undefined);
    await adminCreatePromoCodeHandler(
      request(
        {
          ...BASE_CREATE_PAYLOAD,
          android: {
            monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
            annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
          },
        },
        ADMIN_UID,
      ),
    );

    expect(promoCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        androidBasePlanIdMonthly: 'monthly',
        androidOfferIdMonthly: 'influencer-trial-7d',
        androidBasePlanIdAnnual: 'annual',
        androidOfferIdAnnual: 'influencer-trial-7d-annual',
      }),
    );
  });

  it('creates with Apple monthly configured (correlation fields, never appleOfferCode)', async () => {
    promoCreateMock.mockResolvedValue(undefined);
    await adminCreatePromoCodeHandler(
      request(
        {
          ...BASE_CREATE_PAYLOAD,
          apple: {
            monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' },
          },
        },
        ADMIN_UID,
      ),
    );

    expect(promoCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appleProductIdMonthly: 'ajfit_premium_monthly',
        appleOfferReferenceMonthly: 'Influencer Trial 7D',
        appleProductIdAnnual: null,
        appleOfferReferenceAnnual: null,
        appleOfferCodeMonthly: null,
        appleOfferCodeAnnual: null,
      }),
    );
  });

  it('creates with Apple monthly + annual configured', async () => {
    promoCreateMock.mockResolvedValue(undefined);
    await adminCreatePromoCodeHandler(
      request(
        {
          ...BASE_CREATE_PAYLOAD,
          apple: {
            monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' },
            annual: { productId: 'ajfit_premium_annual', offerReference: 'Influencer Trial 7D Annual' },
          },
        },
        ADMIN_UID,
      ),
    );

    expect(promoCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appleProductIdMonthly: 'ajfit_premium_monthly',
        appleOfferReferenceMonthly: 'Influencer Trial 7D',
        appleProductIdAnnual: 'ajfit_premium_annual',
        appleOfferReferenceAnnual: 'Influencer Trial 7D Annual',
      }),
    );
  });

  it('creates a full multi-platform campaign (Android + Apple, both plans)', async () => {
    promoCreateMock.mockResolvedValue(undefined);
    await adminCreatePromoCodeHandler(
      request(
        {
          ...BASE_CREATE_PAYLOAD,
          android: {
            monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
            annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
          },
          apple: {
            monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' },
            annual: { productId: 'ajfit_premium_annual', offerReference: 'Influencer Trial 7D Annual' },
          },
        },
        ADMIN_UID,
      ),
    );

    expect(promoCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        androidBasePlanIdMonthly: 'monthly',
        androidBasePlanIdAnnual: 'annual',
        appleProductIdMonthly: 'ajfit_premium_monthly',
        appleProductIdAnnual: 'ajfit_premium_annual',
      }),
    );
  });

  it('rejects a partial Android monthly pair (basePlanId without offerId)', async () => {
    await expectHttpsError(
      adminCreatePromoCodeHandler(
        request(
          { ...BASE_CREATE_PAYLOAD, android: { monthly: { basePlanId: 'monthly' } } },
          ADMIN_UID,
        ),
      ),
      'invalid-argument',
      'android_monthly_partial',
    );
    expect(promoCreateMock).not.toHaveBeenCalled();
  });

  it('rejects a partial Apple annual pair (offerReference without productId)', async () => {
    await expectHttpsError(
      adminCreatePromoCodeHandler(
        request(
          { ...BASE_CREATE_PAYLOAD, apple: { annual: { offerReference: 'Influencer Trial 7D Annual' } } },
          ADMIN_UID,
        ),
      ),
      'invalid-argument',
      'apple_annual_partial',
    );
    expect(promoCreateMock).not.toHaveBeenCalled();
  });

  it('rejects a duplicate code with already-exists', async () => {
    promoCreateMock.mockRejectedValue({ code: 6, message: 'ALREADY_EXISTS' });
    await expectHttpsError(
      adminCreatePromoCodeHandler(request(BASE_CREATE_PAYLOAD, ADMIN_UID)),
      'already-exists',
      'promo_code_already_exists',
    );
  });

  it('rejects endsAt before startsAt', async () => {
    await expectHttpsError(
      adminCreatePromoCodeHandler(
        request(
          {
            ...BASE_CREATE_PAYLOAD,
            startsAt: '2026-09-01T00:00:00.000Z',
            endsAt: '2026-08-01T00:00:00.000Z',
          },
          ADMIN_UID,
        ),
      ),
      'invalid-argument',
      'ends_at_before_starts_at',
    );
    expect(promoCreateMock).not.toHaveBeenCalled();
  });

  it.each([
    ['empty string', ''],
    ['invalid characters', 'ARNALDO!'],
    ['whitespace only', '   '],
  ])('rejects an invalid code format: %s', async (_label, code) => {
    await expectHttpsError(
      adminCreatePromoCodeHandler(request({ ...BASE_CREATE_PAYLOAD, code }, ADMIN_UID)),
      'invalid-argument',
      'invalid_code_format',
    );
    expect(promoCreateMock).not.toHaveBeenCalled();
  });

  it('normalizes lowercase/whitespace code input the same way the mobile validator does', async () => {
    promoCreateMock.mockResolvedValue(undefined);
    const result = await adminCreatePromoCodeHandler(
      request({ ...BASE_CREATE_PAYLOAD, code: '  arnaldo  ' }, ADMIN_UID),
    );
    expect(result.code).toBe('ARNALDO');
  });

  it('never trusts a client-supplied createdAt/createdBy — createdBy is always the caller uid, createdAt is always a server timestamp', async () => {
    promoCreateMock.mockResolvedValue(undefined);
    await adminCreatePromoCodeHandler(
      request(
        {
          ...BASE_CREATE_PAYLOAD,
          createdAt: 'attacker-supplied-date',
          createdBy: 'attacker-uid',
        },
        ADMIN_UID,
      ),
    );

    const written = promoCreateMock.mock.calls[0][0];
    expect(written.createdBy).toBe(ADMIN_UID);
    expect(written.createdAt).not.toBe('attacker-supplied-date');
    expect(typeof written.createdAt).toBe('object');
  });

  it('only ever writes the exact PromoCodeDocument key set — no extra fields, no client field leaks through', async () => {
    promoCreateMock.mockResolvedValue(undefined);
    await adminCreatePromoCodeHandler(
      request(
        { ...BASE_CREATE_PAYLOAD, unexpectedField: 'should never reach Firestore' },
        ADMIN_UID,
      ),
    );

    const written = promoCreateMock.mock.calls[0][0];
    expect(Object.keys(written).sort()).toEqual(
      [
        'code',
        'active',
        'startsAt',
        'endsAt',
        'influencerId',
        'campaignId',
        'androidBasePlanIdMonthly',
        'androidOfferIdMonthly',
        'androidBasePlanIdAnnual',
        'androidOfferIdAnnual',
        'appleOfferCodeMonthly',
        'appleOfferCodeAnnual',
        'appleProductIdMonthly',
        'appleOfferReferenceMonthly',
        'appleProductIdAnnual',
        'appleOfferReferenceAnnual',
        'createdAt',
        'updatedAt',
        'createdBy',
        'notes',
      ].sort(),
    );
  });
});

describe('adminUpdatePromoCodeHandler', () => {
  const UPDATE_PAYLOAD = { ...BASE_CREATE_PAYLOAD };

  it('rejects updating a nonexistent code with not-found', async () => {
    promoUpdateMock.mockRejectedValue({ code: 5, message: 'NOT_FOUND' });
    await expectHttpsError(
      adminUpdatePromoCodeHandler(request(UPDATE_PAYLOAD, ADMIN_UID)),
      'not-found',
      'promo_code_not_found',
    );
  });

  it('updates successfully and never includes createdAt/createdBy/code in the write (preserving them)', async () => {
    promoUpdateMock.mockResolvedValue(undefined);
    await adminUpdatePromoCodeHandler(request({ ...UPDATE_PAYLOAD, notes: 'updated notes' }, ADMIN_UID));

    const written = promoUpdateMock.mock.calls[0][0];
    expect(written).not.toHaveProperty('createdAt');
    expect(written).not.toHaveProperty('createdBy');
    expect(written).not.toHaveProperty('code');
    expect(written.notes).toBe('updated notes');
    expect(written).toHaveProperty('updatedAt');
  });

  it('rejects partial Android/Apple pairs on update exactly like create', async () => {
    await expectHttpsError(
      adminUpdatePromoCodeHandler(
        request({ ...UPDATE_PAYLOAD, android: { monthly: { offerId: 'influencer-trial-7d' } } }, ADMIN_UID),
      ),
      'invalid-argument',
      'android_monthly_partial',
    );
    expect(promoUpdateMock).not.toHaveBeenCalled();
  });
});

describe('adminSetPromoCodeActiveHandler', () => {
  it('deactivation writes only active + updatedAt — nothing else', async () => {
    promoUpdateMock.mockResolvedValue(undefined);
    const result = await adminSetPromoCodeActiveHandler(
      request({ code: 'ARNALDO', active: false }, ADMIN_UID),
    );

    expect(result).toEqual({ code: 'ARNALDO', active: false });
    const written = promoUpdateMock.mock.calls[0][0];
    expect(Object.keys(written).sort()).toEqual(['active', 'updatedAt']);
    expect(written.active).toBe(false);
  });

  it('rejects setting active on a nonexistent code with not-found', async () => {
    promoUpdateMock.mockRejectedValue({ code: 5, message: 'NOT_FOUND' });
    await expectHttpsError(
      adminSetPromoCodeActiveHandler(request({ code: 'ARNALDO', active: true }, ADMIN_UID)),
      'not-found',
      'promo_code_not_found',
    );
  });

  it('rejects a missing/invalid active flag', async () => {
    await expectHttpsError(
      adminSetPromoCodeActiveHandler(request({ code: 'ARNALDO', active: 'yes' }, ADMIN_UID)),
      'invalid-argument',
      'invalid_active',
    );
    expect(promoUpdateMock).not.toHaveBeenCalled();
  });
});

describe('adminListPromoCodesHandler', () => {
  it('lists parsed promo codes, skipping malformed documents', async () => {
    collectionGetMock.mockResolvedValue({
      docs: [
        {
          id: 'ARNALDO',
          data: () => ({
            code: 'ARNALDO',
            active: true,
            startsAt: null,
            endsAt: null,
            influencerId: 'ARNALDO',
            campaignId: 'influencer-arnaldo-7d',
            androidBasePlanIdMonthly: null,
            androidOfferIdMonthly: null,
            androidBasePlanIdAnnual: null,
            androidOfferIdAnnual: null,
            appleOfferCodeMonthly: null,
            appleOfferCodeAnnual: null,
            createdAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z')),
            updatedAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z')),
            createdBy: ADMIN_UID,
            notes: null,
          }),
        },
        { id: 'MALFORMED', data: () => ({ garbage: true }) },
      ],
    });

    const result = await adminListPromoCodesHandler(request({}, ADMIN_UID));
    expect(result.promoCodes).toHaveLength(1);
    expect(result.promoCodes[0].id).toBe('ARNALDO');
  });
});

describe('couponRedemptions isolation', () => {
  it('no handler in this module ever reads or writes couponRedemptions', async () => {
    promoCreateMock.mockResolvedValue(undefined);
    promoUpdateMock.mockResolvedValue(undefined);
    collectionGetMock.mockResolvedValue({ docs: [] });

    await adminCreatePromoCodeHandler(request(BASE_CREATE_PAYLOAD, ADMIN_UID));
    await adminUpdatePromoCodeHandler(request(BASE_CREATE_PAYLOAD, ADMIN_UID));
    await adminSetPromoCodeActiveHandler(request({ code: 'ARNALDO', active: false }, ADMIN_UID));
    await adminListPromoCodesHandler(request({}, ADMIN_UID));

    const allDocPaths = docMock.mock.calls.map((call) => call[0]);
    const allCollectionNames = collectionMock.mock.calls.map((call) => call[0]);
    expect(allDocPaths.every((path: string) => !path.startsWith('couponRedemptions/'))).toBe(true);
    expect(allCollectionNames).not.toContain('couponRedemptions');
  });
});
