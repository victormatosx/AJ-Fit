import * as crypto from 'crypto';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const subscriptionSyncMocks = vi.hoisted(() => ({
  applySubscriptionEventAtomically: vi.fn(),
  validFirebaseUserExists: vi.fn(),
  validateSubscriptionPayload: vi.fn(),
}));

const identityMocks = vi.hoisted(() => ({
  resolveRevenueCatFirebaseUid: vi.fn(),
}));

const revenueCatApiMocks = vi.hoisted(() => ({
  createRevenueCatV2Client: vi.fn(),
  getCustomerIdentityGraph: vi.fn(),
  getCustomerSubscriptions: vi.fn(),
}));

// Fase 4B: `handleRevenueCatWebhook` now calls
// `applyAttributionRevenueCatEvent` (attribution/attributionSync.ts) for
// premium-concerning INITIAL_PURCHASE/RENEWAL events that reach `processed`.
// That function uses the REAL `db` from `lib/firebaseAdmin` — mocked here
// (default: no pending attribution for any uid, matching "seguir
// normalmente sem criar atribuição") purely so this file's pre-existing
// subscription-focused tests don't hit a real Firestore transaction.
// Attribution's own behavior is covered by
// `attribution/__tests__/attributionSync.test.ts` and
// `attribution/__tests__/revenueCatConfirmation.test.ts` — not re-tested
// here.
const attributionSyncMocks = vi.hoisted(() => ({
  applyAttributionRevenueCatEvent: vi.fn().mockResolvedValue({
    status: 'skipped',
    reason: 'no_redemption',
  }),
}));

vi.mock('../subscriptionSync', () => subscriptionSyncMocks);
vi.mock('../revenueCatIdentity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../revenueCatIdentity')>();
  return { ...actual, resolveRevenueCatFirebaseUid: identityMocks.resolveRevenueCatFirebaseUid };
});
vi.mock('../revenueCatApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../revenueCatApi')>();
  return {
    ...actual,
    createRevenueCatV2Client: revenueCatApiMocks.createRevenueCatV2Client,
  };
});
vi.mock('../../attribution/attributionSync', () => attributionSyncMocks);

import { handleRevenueCatWebhook } from '../revenuecat';
import { RevenueCatApiError } from '../revenueCatApi';

const SECRET = 'test-signing-secret';
const ORIGINAL_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET;

function sign(timestampSeconds: number, rawBody: Buffer, secret = SECRET): string {
  const signedPayload = Buffer.concat([
    Buffer.from(`${timestampSeconds}.`, 'utf8'),
    rawBody,
  ]);
  const hex = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestampSeconds},v1=${hex}`;
}

function makeRequest(
  body: unknown,
  { signingSecret = SECRET }: { signingSecret?: string } = {},
): Request {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = sign(Math.floor(Date.now() / 1000), rawBody, signingSecret);

  return {
    method: 'POST',
    body,
    rawBody,
    get: vi.fn((header: string) =>
      header.toLowerCase() === 'x-revenuecat-webhook-signature' ? signature : undefined,
    ),
  } as unknown as Request;
}

function makeResponse(): {
  response: Response;
  statusCode: () => number;
  body: () => unknown;
} {
  let statusCode = 200;
  let responseBody: unknown;
  const response = {
    status: vi.fn((nextStatus: number) => {
      statusCode = nextStatus;
      return response;
    }),
    json: vi.fn((nextBody: unknown) => {
      responseBody = nextBody;
      return response;
    }),
  } as unknown as Response;

  return {
    response,
    statusCode: () => statusCode,
    body: () => responseBody,
  };
}

async function invoke(body: unknown, options?: { signingSecret?: string }) {
  const res = makeResponse();
  await handleRevenueCatWebhook(makeRequest(body, options), res.response);
  return res;
}

const completeRenewalEvent = {
  id: 'evt_renewal_handler_001',
  type: 'RENEWAL',
  event_timestamp_ms: Date.parse('2026-08-10T12:00:00.000Z'),
  app_user_id: 'firebase-uid-001',
  product_id: 'ajfit_premium_monthly',
  period_type: 'NORMAL',
  expiration_at_ms: Date.parse('2026-09-10T12:00:00.000Z'),
  store: 'APP_STORE',
  entitlement_ids: ['premium'],
};

const transferEvent = {
  id: 'evt_transfer_001',
  type: 'TRANSFER',
  event_timestamp_ms: Date.parse('2026-08-10T12:00:00.000Z'),
  transferred_from: ['firebase-uid-001'],
  transferred_to: ['firebase-uid-002'],
  environment: 'SANDBOX',
};

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-premium-active',
    customerId: 'rc-customer-002',
    originalCustomerId: 'rc-customer-002',
    productId: 'prod-monthly',
    startsAtMs: Date.parse('2026-07-10T12:00:00.000Z'),
    currentPeriodStartsAtMs: Date.parse('2026-08-10T12:00:00.000Z'),
    currentPeriodEndsAtMs: Date.parse('2026-09-10T12:00:00.000Z'),
    endsAtMs: null,
    givesAccess: true,
    pendingPayment: false,
    autoRenewalStatus: 'will_renew',
    status: 'active',
    entitlements: [
      {
        id: 'ent-premium',
        lookupKey: 'premium',
        products: [{ id: 'prod-monthly', storeIdentifier: 'ajfit_premium_monthly' }],
      },
    ],
    environment: 'sandbox',
    store: 'app_store',
    ...overrides,
  };
}

const resolvedTransferDestination = {
  status: 'resolved' as const,
  uid: 'firebase-uid-002',
  source: 'revenuecat_v2' as const,
  customerIds: ['rc-customer-002'],
};

const resolvedTransferSource = {
  status: 'resolved' as const,
  uid: 'firebase-uid-001',
  source: 'revenuecat_v2' as const,
  customerIds: ['rc-customer-001'],
};

function mockResolvedTransferSides(
  sourceResolution:
    | typeof resolvedTransferSource
    | { status: 'unresolved' }
    | { status: 'ambiguous'; candidateCount: number } = resolvedTransferSource,
): void {
  identityMocks.resolveRevenueCatFirebaseUid
    .mockResolvedValueOnce(resolvedTransferDestination)
    .mockResolvedValueOnce(sourceResolution);
}

describe('handleRevenueCatWebhook validation order', () => {
  beforeEach(() => {
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
    vi.clearAllMocks();
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'resolved',
      uid: completeRenewalEvent.app_user_id,
      source: 'direct',
      customerIds: [],
    });
    revenueCatApiMocks.createRevenueCatV2Client.mockReturnValue({
      getCustomerIdentityGraph: revenueCatApiMocks.getCustomerIdentityGraph,
      getCustomerSubscriptions: revenueCatApiMocks.getCustomerSubscriptions,
    });
    revenueCatApiMocks.getCustomerSubscriptions.mockResolvedValue([subscription()]);
    subscriptionSyncMocks.validateSubscriptionPayload.mockImplementation((payload: unknown) => ({
      ok: true,
      data: payload,
    }));
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({
      status: 'processed',
    });
  });

  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_SECRET;
    } else {
      process.env.REVENUECAT_WEBHOOK_SECRET = ORIGINAL_SECRET;
    }
  });

  it('A: reconciles a uniquely resolved active Premium TRANSFER', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'resolved',
      uid: 'firebase-uid-002',
      source: 'revenuecat_v2',
      customerIds: ['rc-customer-002'],
    });
    const result = await invoke({ api_version: '1.0', event: transferEvent });

    expect(result.statusCode()).toBe(200);
    expect(result.body()).toEqual({ status: 'processed', reconciliation: 'active' });
    expect(identityMocks.resolveRevenueCatFirebaseUid).toHaveBeenCalledWith(
      expect.objectContaining({
        aliases: ['firebase-uid-002'],
        lookupIds: ['firebase-uid-002'],
        allowPayloadFastPath: false,
      }),
      expect.any(Object),
    );
    expect(revenueCatApiMocks.getCustomerSubscriptions).toHaveBeenCalledWith(
      'rc-customer-002',
      'sandbox',
    );
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledWith(
      'firebase-uid-002',
      transferEvent.id,
      transferEvent.event_timestamp_ms,
      expect.objectContaining({
        provider: 'REVENUECAT',
        entitlementActive: true,
        productId: 'ajfit_premium_monthly',
        store: 'APP_STORE',
        status: 'ACTIVE',
      }),
      { replaceSubscription: true },
    );
  });

  it('B: replaces a stale active mirror with an unequivocally inactive Premium state', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'resolved',
      uid: 'firebase-uid-002',
      source: 'revenuecat_v2',
      customerIds: ['rc-customer-002'],
    });
    revenueCatApiMocks.getCustomerSubscriptions.mockResolvedValue([
      subscription({
        id: 'sub-premium-expired',
        givesAccess: false,
        autoRenewalStatus: 'will_not_renew',
        status: 'expired',
      }),
    ]);

    const result = await invoke({ api_version: '1.0', event: transferEvent });

    expect(result.body()).toEqual({ status: 'processed', reconciliation: 'inactive' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledWith(
      'firebase-uid-002',
      transferEvent.id,
      transferEvent.event_timestamp_ms,
      expect.objectContaining({ entitlementActive: false, status: 'EXPIRED' }),
      { replaceSubscription: true },
    );
  });

  it('C: acknowledges an unresolved TRANSFER without reading subscriptions or writing', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({ status: 'unresolved' });

    const result = await invoke({ api_version: '1.0', event: transferEvent });

    expect(result.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
    expect(revenueCatApiMocks.getCustomerSubscriptions).not.toHaveBeenCalled();
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });

  it('D: acknowledges an ambiguous TRANSFER identity without writing', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'ambiguous',
      candidateCount: 2,
    });

    const result = await invoke({ api_version: '1.0', event: transferEvent });

    expect(result.body()).toEqual({ status: 'ignored', reason: 'identity_ambiguous' });
    expect(revenueCatApiMocks.getCustomerSubscriptions).not.toHaveBeenCalled();
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });

  it.each([
    ['E: timeout', new RevenueCatApiError('temporary')],
    ['F: HTTP 429', new RevenueCatApiError('temporary', 429)],
    ['G: HTTP 5xx', new RevenueCatApiError('temporary', 503)],
    ['I: invalid schema', new RevenueCatApiError('invalid_response', 200)],
    ['404 customer', new RevenueCatApiError('not_found', 404)],
  ])('%s during TRANSFER returns retryable 503 and never writes', async (_case, error) => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'resolved',
      uid: 'firebase-uid-002',
      source: 'revenuecat_v2',
      customerIds: ['rc-customer-002'],
    });
    revenueCatApiMocks.getCustomerSubscriptions.mockRejectedValue(error);

    const result = await invoke({ api_version: '1.0', event: transferEvent });

    expect(result.statusCode()).toBe(503);
    expect(result.body()).toEqual({ error: 'revenuecat_api_temporary_failure' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'H: RevenueCat API status %s during TRANSFER is a configuration error with no write',
    async (status) => {
      identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
        status: 'resolved',
        uid: 'firebase-uid-002',
        source: 'revenuecat_v2',
        customerIds: ['rc-customer-002'],
      });
      revenueCatApiMocks.getCustomerSubscriptions.mockRejectedValue(
        new RevenueCatApiError('authentication', status),
      );

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.statusCode()).toBe(500);
      expect(result.body()).toEqual({ error: 'revenuecat_api_configuration_error' });
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
    },
  );

  it('J: selects the only active Premium subscription among multiple subscriptions', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'resolved',
      uid: 'firebase-uid-002',
      source: 'revenuecat_v2',
      customerIds: ['rc-customer-002'],
    });
    revenueCatApiMocks.getCustomerSubscriptions.mockResolvedValue([
      subscription({
        id: 'sub-unrelated-active',
        productId: 'prod-other',
        entitlements: [{ id: 'ent-other', lookupKey: 'other', products: [] }],
      }),
      subscription({ id: 'sub-premium-expired', givesAccess: false, status: 'expired' }),
      subscription({
        id: 'sub-premium-yearly',
        productId: 'prod-yearly',
        entitlements: [
          {
            id: 'ent-premium',
            lookupKey: 'premium',
            products: [{ id: 'prod-yearly', storeIdentifier: 'ajfit_premium_yearly' }],
          },
        ],
      }),
    ]);

    const result = await invoke({ api_version: '1.0', event: transferEvent });

    expect(result.body()).toEqual({ status: 'processed', reconciliation: 'active' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledWith(
      'firebase-uid-002',
      transferEvent.id,
      transferEvent.event_timestamp_ms,
      expect.objectContaining({ productId: 'ajfit_premium_yearly', entitlementActive: true }),
      { replaceSubscription: true },
    );
  });

  it('K: fails closed when multiple Premium subscriptions give access', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'resolved',
      uid: 'firebase-uid-002',
      source: 'revenuecat_v2',
      customerIds: ['rc-customer-002'],
    });
    revenueCatApiMocks.getCustomerSubscriptions.mockResolvedValue([
      subscription({ id: 'sub-premium-one' }),
      subscription({ id: 'sub-premium-two', environment: 'production' }),
    ]);

    const result = await invoke({ api_version: '1.0', event: transferEvent });

    expect(result.body()).toEqual({
      status: 'ignored',
      reason: 'transfer_reconciliation_ambiguous',
    });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });

  it.each([
    ['L: stale', 'stale'],
    ['M: duplicate', 'duplicate'],
  ] as const)('%s TRANSFER preserves the transaction outcome', async (_case, status) => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'resolved',
      uid: 'firebase-uid-002',
      source: 'revenuecat_v2',
      customerIds: ['rc-customer-002'],
    });
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({ status });

    const result = await invoke({ api_version: '1.0', event: transferEvent });

    expect(result.body()).toEqual({ status });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledWith(
      'firebase-uid-002',
      transferEvent.id,
      transferEvent.event_timestamp_ms,
      expect.any(Object),
      { replaceSubscription: true },
    );
  });

  it('N: a user removed before the TRANSFER transaction is not recreated', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'resolved',
      uid: 'firebase-uid-002',
      source: 'revenuecat_v2',
      customerIds: ['rc-customer-002'],
    });
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({
      status: 'user_not_found',
    });

    const result = await invoke({ api_version: '1.0', event: transferEvent });

    expect(result.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
  });

  describe('TRANSFER source and destination reconciliation', () => {
    it('A: mirrors A inactive and B active from their current RevenueCat states', async () => {
      mockResolvedTransferSides();
      revenueCatApiMocks.getCustomerSubscriptions.mockImplementation(async (customerId) =>
        customerId === 'rc-customer-002' ? [subscription()] : [],
      );

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.statusCode()).toBe(200);
      expect(result.body()).toEqual({ status: 'processed', reconciliation: 'active' });
      expect(identityMocks.resolveRevenueCatFirebaseUid).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          aliases: ['firebase-uid-001'],
          lookupIds: ['firebase-uid-001'],
          allowPayloadFastPath: false,
        }),
        expect.any(Object),
      );
      expect(revenueCatApiMocks.getCustomerSubscriptions).toHaveBeenNthCalledWith(
        1,
        'rc-customer-002',
        'sandbox',
      );
      expect(revenueCatApiMocks.getCustomerSubscriptions).toHaveBeenNthCalledWith(
        2,
        'rc-customer-001',
        'sandbox',
      );
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenNthCalledWith(
        1,
        'firebase-uid-002',
        transferEvent.id,
        transferEvent.event_timestamp_ms,
        expect.objectContaining({ entitlementActive: true }),
        { replaceSubscription: true },
      );
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenNthCalledWith(
        2,
        'firebase-uid-001',
        transferEvent.id,
        transferEvent.event_timestamp_ms,
        { provider: 'REVENUECAT', entitlementActive: false },
        { replaceSubscription: true },
      );
    });

    it('B: reconciles both valid Firebase users without blindly deactivating the source', async () => {
      mockResolvedTransferSides();
      revenueCatApiMocks.getCustomerSubscriptions.mockImplementation(async (customerId) => [
        subscription({
          id: customerId === 'rc-customer-002' ? 'sub-destination' : 'sub-source',
          customerId,
          originalCustomerId: customerId,
        }),
      ]);

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.body()).toEqual({ status: 'processed', reconciliation: 'active' });
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledTimes(2);
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenNthCalledWith(
        2,
        'firebase-uid-001',
        transferEvent.id,
        transferEvent.event_timestamp_ms,
        expect.objectContaining({ entitlementActive: true }),
        { replaceSubscription: true },
      );
    });

    it('C: ignores a nonexistent source while still updating a valid destination', async () => {
      mockResolvedTransferSides({ status: 'unresolved' });

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.body()).toEqual({ status: 'processed', reconciliation: 'active' });
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledOnce();
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledWith(
        'firebase-uid-002',
        transferEvent.id,
        transferEvent.event_timestamp_ms,
        expect.objectContaining({ entitlementActive: true }),
        { replaceSubscription: true },
      );
    });

    it('D: never resolves or writes an anonymous-only source', async () => {
      identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValueOnce(
        resolvedTransferDestination,
      );

      const result = await invoke({
        api_version: '1.0',
        event: {
          ...transferEvent,
          transferred_from: ['$RCAnonymousID:source-anonymous'],
        },
      });

      expect(result.body()).toEqual({ status: 'processed', reconciliation: 'active' });
      expect(identityMocks.resolveRevenueCatFirebaseUid).toHaveBeenCalledOnce();
      expect(revenueCatApiMocks.getCustomerSubscriptions).toHaveBeenCalledOnce();
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledOnce();
    });

    it('E: ignores an ambiguous source while still updating a valid destination', async () => {
      mockResolvedTransferSides({ status: 'ambiguous', candidateCount: 2 });

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.body()).toEqual({ status: 'processed', reconciliation: 'active' });
      expect(revenueCatApiMocks.getCustomerSubscriptions).toHaveBeenCalledOnce();
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledOnce();
    });

    it('F: fails closed for an ambiguous destination and never processes the source', async () => {
      identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValueOnce({
        status: 'ambiguous',
        candidateCount: 2,
      });

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.body()).toEqual({ status: 'ignored', reason: 'identity_ambiguous' });
      expect(identityMocks.resolveRevenueCatFirebaseUid).toHaveBeenCalledOnce();
      expect(revenueCatApiMocks.getCustomerSubscriptions).not.toHaveBeenCalled();
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
    });

    it('G: preserves duplicate outcomes independently for both documents', async () => {
      mockResolvedTransferSides();
      revenueCatApiMocks.getCustomerSubscriptions.mockImplementation(async (customerId) =>
        customerId === 'rc-customer-002' ? [subscription()] : [],
      );
      subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({
        status: 'duplicate',
      });

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.body()).toEqual({ status: 'duplicate' });
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledTimes(2);
    });

    it('G/retry: completes the source after a partial temporary failure without reapplying B', async () => {
      identityMocks.resolveRevenueCatFirebaseUid
        .mockResolvedValueOnce(resolvedTransferDestination)
        .mockResolvedValueOnce(resolvedTransferSource)
        .mockResolvedValueOnce(resolvedTransferDestination)
        .mockResolvedValueOnce(resolvedTransferSource);
      let sourceReadAttempts = 0;
      revenueCatApiMocks.getCustomerSubscriptions.mockImplementation(async (customerId) => {
        if (customerId === 'rc-customer-002') return [subscription()];
        sourceReadAttempts += 1;
        if (sourceReadAttempts === 1) throw new RevenueCatApiError('temporary', 503);
        return [];
      });
      let destinationApplyAttempts = 0;
      subscriptionSyncMocks.applySubscriptionEventAtomically.mockImplementation(async (uid) => {
        if (uid === 'firebase-uid-002') {
          destinationApplyAttempts += 1;
          return { status: destinationApplyAttempts === 1 ? 'processed' : 'duplicate' };
        }
        return { status: 'processed' };
      });

      const firstAttempt = await invoke({ api_version: '1.0', event: transferEvent });
      const retry = await invoke({ api_version: '1.0', event: transferEvent });

      expect(firstAttempt.statusCode()).toBe(503);
      expect(firstAttempt.body()).toEqual({ error: 'revenuecat_api_temporary_failure' });
      expect(retry.statusCode()).toBe(200);
      expect(retry.body()).toEqual({ status: 'duplicate' });
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically.mock.calls.map(([uid]) => uid))
        .toEqual(['firebase-uid-002', 'firebase-uid-002', 'firebase-uid-001']);
    });

    it('H: preserves stale outcomes independently for both documents', async () => {
      mockResolvedTransferSides();
      revenueCatApiMocks.getCustomerSubscriptions.mockImplementation(async (customerId) =>
        customerId === 'rc-customer-002' ? [subscription()] : [],
      );
      subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({ status: 'stale' });

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.body()).toEqual({ status: 'stale' });
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledTimes(2);
    });

    it('I: does not recreate a source deleted before its transaction', async () => {
      mockResolvedTransferSides();
      revenueCatApiMocks.getCustomerSubscriptions.mockImplementation(async (customerId) =>
        customerId === 'rc-customer-002' ? [subscription()] : [],
      );
      subscriptionSyncMocks.applySubscriptionEventAtomically
        .mockResolvedValueOnce({ status: 'processed' })
        .mockResolvedValueOnce({ status: 'user_not_found' });

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.body()).toEqual({ status: 'processed', reconciliation: 'active' });
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledTimes(2);
    });

    it('J: does not recreate a destination deleted before its transaction', async () => {
      identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValueOnce(
        resolvedTransferDestination,
      );
      subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValueOnce({
        status: 'user_not_found',
      });

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
      expect(identityMocks.resolveRevenueCatFirebaseUid).toHaveBeenCalledOnce();
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledOnce();
    });

    it('K: returns retryable 503 after preserving B when the source V2 read is temporary', async () => {
      mockResolvedTransferSides();
      revenueCatApiMocks.getCustomerSubscriptions.mockImplementation(async (customerId) => {
        if (customerId === 'rc-customer-002') return [subscription()];
        throw new RevenueCatApiError('temporary', 503);
      });

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.statusCode()).toBe(503);
      expect(result.body()).toEqual({ error: 'revenuecat_api_temporary_failure' });
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledOnce();
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledWith(
        'firebase-uid-002',
        transferEvent.id,
        transferEvent.event_timestamp_ms,
        expect.any(Object),
        { replaceSubscription: true },
      );
    });

    it('L: returns retryable 503 without any write when the destination V2 read is temporary', async () => {
      identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValueOnce(
        resolvedTransferDestination,
      );
      revenueCatApiMocks.getCustomerSubscriptions.mockRejectedValue(
        new RevenueCatApiError('temporary', 503),
      );

      const result = await invoke({ api_version: '1.0', event: transferEvent });

      expect(result.statusCode()).toBe(503);
      expect(result.body()).toEqual({ error: 'revenuecat_api_temporary_failure' });
      expect(identityMocks.resolveRevenueCatFirebaseUid).toHaveBeenCalledOnce();
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
    });
  });

  it('B: rejects a supported event without app_user_id', async () => {
    const { app_user_id: _appUserId, ...eventWithoutAppUserId } = completeRenewalEvent;
    const result = await invoke({ api_version: '1.0', event: eventWithoutAppUserId });

    expect(result.statusCode()).toBe(400);
    expect(result.body()).toEqual({ error: 'invalid_payload' });
    expect(identityMocks.resolveRevenueCatFirebaseUid).not.toHaveBeenCalled();
  });

  it('O: keeps a complete commercial event in the existing Firestore pipeline', async () => {
    const result = await invoke({ api_version: '1.0', event: completeRenewalEvent });

    expect(identityMocks.resolveRevenueCatFirebaseUid).toHaveBeenCalledWith(
      expect.objectContaining({
        directAppUserId: completeRenewalEvent.app_user_id,
        lookupIds: [completeRenewalEvent.app_user_id],
      }),
      expect.any(Object),
    );
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledOnce();
    expect(result.statusCode()).toBe(200);
    expect(result.body()).toEqual({ status: 'processed' });
  });

  it('B/K: applies an alias-resolved commercial event to the resolved current uid', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'resolved',
      uid: 'firebase-current-uid',
      source: 'revenuecat_v2',
      customerIds: ['rc-customer-current'],
    });

    const result = await invoke({
      api_version: '1.0',
      event: { ...completeRenewalEvent, app_user_id: 'firebase-deleted-uid' },
    });

    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledWith(
      'firebase-current-uid',
      completeRenewalEvent.id,
      completeRenewalEvent.event_timestamp_ms,
      expect.any(Object),
    );
    expect(result.body()).toEqual({ status: 'processed' });
  });

  it('D: rejects an event without event.id', async () => {
    const { id: _id, ...eventWithoutId } = completeRenewalEvent;
    const result = await invoke({ api_version: '1.0', event: eventWithoutId });

    expect(result.statusCode()).toBe(400);
    expect(result.body()).toEqual({ error: 'invalid_payload' });
    expect(identityMocks.resolveRevenueCatFirebaseUid).not.toHaveBeenCalled();
  });

  it('E: rejects an event without event.type', async () => {
    const { type: _type, ...eventWithoutType } = completeRenewalEvent;
    const result = await invoke({ api_version: '1.0', event: eventWithoutType });

    expect(result.statusCode()).toBe(400);
    expect(result.body()).toEqual({ error: 'invalid_payload' });
    expect(identityMocks.resolveRevenueCatFirebaseUid).not.toHaveBeenCalled();
  });

  it('F: rejects an invalid HMAC before inspecting or processing the event', async () => {
    const result = await invoke(
      { api_version: '1.0', event: completeRenewalEvent },
      { signingSecret: 'wrong-secret' },
    );

    expect(result.statusCode()).toBe(401);
    expect(result.body()).toEqual({ error: 'invalid_signature' });
    expect(identityMocks.resolveRevenueCatFirebaseUid).not.toHaveBeenCalled();
  });

  it('G: acknowledges another unsupported event with a valid envelope', async () => {
    const result = await invoke({
      api_version: '1.0',
      event: {
        id: 'evt_uncancellation_001',
        type: 'UNCANCELLATION',
        event_timestamp_ms: Date.parse('2026-08-10T12:00:00.000Z'),
        app_user_id: 'firebase-uid-001',
      },
    });

    expect(result.statusCode()).toBe(200);
    expect(result.body()).toEqual({ status: 'ignored', reason: 'unsupported_event_type' });
    expect(identityMocks.resolveRevenueCatFirebaseUid).not.toHaveBeenCalled();
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });

  it('C/L: acknowledges an ambiguous commercial identity without writing', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'ambiguous',
      candidateCount: 2,
    });

    const result = await invoke({ api_version: '1.0', event: completeRenewalEvent });

    expect(result.statusCode()).toBe(200);
    expect(result.body()).toEqual({ status: 'ignored', reason: 'identity_ambiguous' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });

  it('C: acknowledges an unresolved commercial identity without writing', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({ status: 'unresolved' });

    const result = await invoke({ api_version: '1.0', event: completeRenewalEvent });

    expect(result.statusCode()).toBe(200);
    expect(result.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });

  it('does not recreate a user deleted between resolution and the Firestore transaction', async () => {
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({
      status: 'user_not_found',
    });

    const result = await invoke({ api_version: '1.0', event: completeRenewalEvent });

    expect(result.statusCode()).toBe(200);
    expect(result.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
  });

  it('I: returns 503 for a temporary RevenueCat API failure and does not write', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockRejectedValue(
      new RevenueCatApiError('temporary', 503),
    );

    const result = await invoke({ api_version: '1.0', event: completeRenewalEvent });

    expect(result.statusCode()).toBe(503);
    expect(result.body()).toEqual({ error: 'revenuecat_api_temporary_failure' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'J: returns an operational error for RevenueCat API status %s and does not write',
    async (status) => {
      identityMocks.resolveRevenueCatFirebaseUid.mockRejectedValue(
        new RevenueCatApiError('authentication', status),
      );

      const result = await invoke({ api_version: '1.0', event: completeRenewalEvent });

      expect(result.statusCode()).toBe(500);
      expect(result.body()).toEqual({ error: 'revenuecat_api_configuration_error' });
      expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
    },
  );

  it('rejects a TRANSFER without event_timestamp_ms before reconciliation', async () => {
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'ambiguous',
      candidateCount: 2,
    });

    const result = await invoke({
      event: {
        id: 'evt_transfer_ambiguous',
        type: 'TRANSFER',
        transferred_to: ['firebase-uid-001', 'firebase-uid-002'],
      },
    });

    expect(result.statusCode()).toBe(400);
    expect(result.body()).toEqual({ error: 'invalid_payload' });
    expect(identityMocks.resolveRevenueCatFirebaseUid).not.toHaveBeenCalled();
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });
});

// Fase 4B — integration-level tests for `confirmPromoCodeAttributionIfApplicable`
// (billing/revenuecat.ts). Attribution's own decision/transaction logic is
// tested in attribution/__tests__/revenueCatConfirmation.test.ts; these
// tests only verify that the webhook handler calls (or correctly refrains
// from calling) `applyAttributionRevenueCatEvent` with the right arguments,
// at the right point in the flow.
describe('handleRevenueCatWebhook — Fase 4B attribution confirmation wiring', () => {
  const initialPurchaseEvent = {
    id: 'evt_initial_purchase_attribution_001',
    type: 'INITIAL_PURCHASE',
    event_timestamp_ms: Date.parse('2026-08-11T12:00:00.000Z'),
    purchased_at_ms: Date.parse('2026-08-11T11:59:59.000Z'),
    app_user_id: 'firebase-uid-001',
    product_id: 'ajfit_premium_monthly',
    period_type: 'TRIAL',
    expiration_at_ms: Date.parse('2026-08-18T12:00:00.000Z'),
    store: 'APP_STORE',
    entitlement_ids: ['premium'],
  };

  beforeEach(() => {
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
    vi.clearAllMocks();
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'resolved',
      uid: 'firebase-uid-001',
      source: 'direct',
      customerIds: [],
    });
    subscriptionSyncMocks.validateSubscriptionPayload.mockImplementation((payload: unknown) => ({
      ok: true,
      data: payload,
    }));
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({
      status: 'processed',
    });
    attributionSyncMocks.applyAttributionRevenueCatEvent.mockResolvedValue({
      status: 'skipped',
      reason: 'no_redemption',
    });
  });

  it('calls applyAttributionRevenueCatEvent for a processed, premium-concerning INITIAL_PURCHASE', async () => {
    const result = await invoke({ api_version: '1.0', event: initialPurchaseEvent });

    expect(result.statusCode()).toBe(200);
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).toHaveBeenCalledWith(
      'firebase-uid-001',
      {
        eventType: 'INITIAL_PURCHASE',
        eventTimestampMs: initialPurchaseEvent.event_timestamp_ms,
        eventId: initialPurchaseEvent.id,
        purchasedAtMs: initialPurchaseEvent.purchased_at_ms,
        periodType: 'TRIAL',
        store: 'APP_STORE',
        productId: 'ajfit_premium_monthly',
        offerCode: undefined,
      },
    );
  });

  it('calls applyAttributionRevenueCatEvent for a processed, premium-concerning RENEWAL, passing is_trial_conversion through', async () => {
    const result = await invoke({
      api_version: '1.0',
      event: { ...completeRenewalEvent, is_trial_conversion: true },
    });

    expect(result.statusCode()).toBe(200);
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).toHaveBeenCalledWith(
      completeRenewalEvent.app_user_id,
      {
        eventType: 'RENEWAL',
        eventTimestampMs: completeRenewalEvent.event_timestamp_ms,
        isTrialConversion: true,
      },
    );
  });

  it('treats a missing is_trial_conversion as false, never as a guess', async () => {
    await invoke({ api_version: '1.0', event: completeRenewalEvent });

    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).toHaveBeenCalledWith(
      completeRenewalEvent.app_user_id,
      expect.objectContaining({ isTrialConversion: false }),
    );
  });

  // FASE 4B.1: this is the exact bug this phase fixes — billing's own
  // dedup/staleness must NOT, by itself, prevent attribution from being
  // (re-)evaluated. See the "recovery" describe block below for the full
  // two-delivery scenario this enables.
  it('G/D: STILL calls attribution confirmation when the subscription event is a duplicate', async () => {
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({ status: 'duplicate' });

    const result = await invoke({ api_version: '1.0', event: initialPurchaseEvent });

    expect(result.body()).toEqual({ status: 'duplicate' });
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).toHaveBeenCalledWith(
      'firebase-uid-001',
      expect.objectContaining({ eventType: 'INITIAL_PURCHASE' }),
    );
  });

  // FASE 4B.1 rule (Parte 5): a `stale` billing delivery can still be the
  // only INITIAL_PURCHASE attribution has ever seen for this uid. It must
  // be evaluated — the write-once fields inside `applyAttributionRevenueCatEvent`
  // are what protect against unsafe overwrites, not billing's staleness flag.
  it('G: STILL calls attribution confirmation when the subscription event is stale', async () => {
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({ status: 'stale' });

    const result = await invoke({ api_version: '1.0', event: initialPurchaseEvent });

    expect(result.body()).toEqual({ status: 'stale' });
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).toHaveBeenCalledWith(
      'firebase-uid-001',
      expect.objectContaining({ eventType: 'INITIAL_PURCHASE' }),
    );
  });

  it('I: RENEWAL stale/duplicate never overwrites convertedAt — trusts applyAttributionRevenueCatEvent, still gets called', async () => {
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({ status: 'stale' });
    attributionSyncMocks.applyAttributionRevenueCatEvent.mockResolvedValue({
      status: 'skipped',
      reason: 'already_converted',
    });

    const result = await invoke({
      api_version: '1.0',
      event: { ...completeRenewalEvent, is_trial_conversion: true },
    });

    expect(result.body()).toEqual({ status: 'stale' });
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).toHaveBeenCalledWith(
      completeRenewalEvent.app_user_id,
      expect.objectContaining({ eventType: 'RENEWAL', isTrialConversion: true }),
    );
  });

  it('J: no couponRedemptions/{uid} — no-op, HTTP stays 200, no retry requested', async () => {
    attributionSyncMocks.applyAttributionRevenueCatEvent.mockResolvedValue({
      status: 'skipped',
      reason: 'no_redemption',
    });

    const result = await invoke({ api_version: '1.0', event: initialPurchaseEvent });

    expect(result.statusCode()).toBe(200);
    expect(result.body()).toEqual({ status: 'processed' });
  });

  it('K: attribution locked — applyAttributionRevenueCatEvent is still called, but this handler never inspects/touches couponCode/campaignId/influencerId itself', async () => {
    attributionSyncMocks.applyAttributionRevenueCatEvent.mockResolvedValue({
      status: 'skipped',
      reason: 'locked',
    });

    const result = await invoke({ api_version: '1.0', event: initialPurchaseEvent });

    expect(result.statusCode()).toBe(200);
    const [, input] = attributionSyncMocks.applyAttributionRevenueCatEvent.mock.calls[0];
    expect(input).not.toHaveProperty('couponCode');
    expect(input).not.toHaveProperty('campaignId');
    expect(input).not.toHaveProperty('influencerId');
  });

  it('does NOT call attribution confirmation for CANCELLATION (rule 7: no additional metrics this phase)', async () => {
    await invoke({
      api_version: '1.0',
      event: { ...initialPurchaseEvent, type: 'CANCELLATION', period_type: 'NORMAL' },
    });

    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).not.toHaveBeenCalled();
  });

  it('does NOT call attribution confirmation for EXPIRATION', async () => {
    await invoke({ api_version: '1.0', event: { ...initialPurchaseEvent, type: 'EXPIRATION' } });

    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).not.toHaveBeenCalled();
  });

  it('does NOT call attribution confirmation when the event does not concern the premium entitlement', async () => {
    await invoke({
      api_version: '1.0',
      event: { ...initialPurchaseEvent, entitlement_ids: ['some_other_entitlement'] },
    });

    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).not.toHaveBeenCalled();
  });

  it('does NOT call attribution confirmation for TRANSFER (rule 5: attribution is never moved/created/copied)', async () => {
    identityMocks.resolveRevenueCatFirebaseUid
      .mockResolvedValueOnce({
        status: 'resolved',
        uid: 'firebase-uid-002',
        source: 'revenuecat_v2',
        customerIds: ['rc-customer-dest'],
      })
      .mockResolvedValueOnce({
        status: 'resolved',
        uid: 'firebase-uid-001',
        source: 'revenuecat_v2',
        customerIds: ['rc-customer-src'],
      });
    revenueCatApiMocks.createRevenueCatV2Client.mockReturnValue({
      getCustomerIdentityGraph: revenueCatApiMocks.getCustomerIdentityGraph,
      getCustomerSubscriptions: revenueCatApiMocks.getCustomerSubscriptions,
    });
    revenueCatApiMocks.getCustomerSubscriptions.mockResolvedValue([subscription()]);

    await invoke({
      api_version: '1.0',
      event: {
        id: 'evt_transfer_attribution_check',
        type: 'TRANSFER',
        event_timestamp_ms: Date.parse('2026-08-11T12:00:00.000Z'),
        transferred_from: ['firebase-uid-001'],
        transferred_to: ['firebase-uid-002'],
        environment: 'SANDBOX',
      },
    });

    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).not.toHaveBeenCalled();
  });

  // FASE 4B.1: this is the bug being fixed — a transient attribution
  // failure must NEVER be silently swallowed into a 200. It must be
  // retryable so RevenueCat gives attribution another chance.
  it('B: billing processed + attribution temporary failure → HTTP retryable (503), never a silent 200', async () => {
    attributionSyncMocks.applyAttributionRevenueCatEvent.mockRejectedValue(new Error('boom'));

    const result = await invoke({ api_version: '1.0', event: initialPurchaseEvent });

    expect(result.statusCode()).toBe(503);
    expect(result.body()).toEqual({ error: 'attribution_temporary_failure' });
  });

  it('E: RENEWAL — billing processed + attribution temporary failure → HTTP retryable', async () => {
    attributionSyncMocks.applyAttributionRevenueCatEvent.mockRejectedValue(new Error('boom'));

    const result = await invoke({
      api_version: '1.0',
      event: { ...completeRenewalEvent, is_trial_conversion: true },
    });

    expect(result.statusCode()).toBe(503);
    expect(result.body()).toEqual({ error: 'attribution_temporary_failure' });
  });

  it('A: billing processed + attribution success → HTTP 200', async () => {
    attributionSyncMocks.applyAttributionRevenueCatEvent.mockResolvedValue({ status: 'confirmed' });

    const result = await invoke({ api_version: '1.0', event: initialPurchaseEvent });

    expect(result.statusCode()).toBe(200);
    expect(result.body()).toEqual({ status: 'processed' });
  });

  it('N: does NOT call attribution confirmation for CANCELLATION/EXPIRATION even when billing is duplicate/stale', async () => {
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({ status: 'duplicate' });

    await invoke({
      api_version: '1.0',
      event: { ...initialPurchaseEvent, type: 'CANCELLATION', period_type: 'NORMAL' },
    });

    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).not.toHaveBeenCalled();
  });

  it('M: non-premium event stays not_applicable even when billing is duplicate/stale', async () => {
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({ status: 'stale' });

    const result = await invoke({
      api_version: '1.0',
      event: { ...initialPurchaseEvent, entitlement_ids: ['some_other_entitlement'] },
    });

    expect(result.statusCode()).toBe(200);
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).not.toHaveBeenCalled();
  });

  it('does NOT evaluate attribution for conflict or user_not_found (out of scope for this fix — anomalous states)', async () => {
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({ status: 'conflict' });
    await invoke({ api_version: '1.0', event: initialPurchaseEvent });
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).not.toHaveBeenCalled();

    vi.clearAllMocks();
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValue({ status: 'user_not_found' });
    await invoke({ api_version: '1.0', event: initialPurchaseEvent });
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).not.toHaveBeenCalled();
  });

  it('O: a critical billing failure (thrown by applySubscriptionEventAtomically) preserves the existing 500 behavior — attribution is never reached', async () => {
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockRejectedValue(new Error('firestore down'));

    const result = await invoke({ api_version: '1.0', event: initialPurchaseEvent });

    expect(result.statusCode()).toBe(500);
    expect(result.body()).toEqual({ error: 'internal_error' });
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).not.toHaveBeenCalled();
  });

  it('P/Q: no response body from this handler ever mentions subscription/entitlement/premium, regardless of attribution outcome', async () => {
    for (const attributionResult of [
      { status: 'confirmed' as const },
      { status: 'skipped' as const, reason: 'no_redemption' as const },
    ]) {
      attributionSyncMocks.applyAttributionRevenueCatEvent.mockResolvedValue(attributionResult);
      const result = await invoke({ api_version: '1.0', event: initialPurchaseEvent });
      expect(JSON.stringify(result.body())).not.toMatch(/entitlement|premium|subscription/i);
    }
  });

  it('the attribution confirmation result never mentions subscription/entitlement/premium fields written by this handler', async () => {
    const result = await invoke({ api_version: '1.0', event: initialPurchaseEvent });
    expect(Object.keys(result.body() as object)).toEqual(['status']);
  });
});

// FASE 4B.1 — TESTE-CHAVE: the exact two-delivery recovery scenario this
// phase exists to fix. Billing succeeds on delivery 1 (and correctly
// deduplicates on delivery 2); attribution fails transiently on delivery 1
// and recovers on delivery 2 — driven entirely by the SAME event.id, exactly
// as RevenueCat's own retry mechanism would redeliver it.
describe('FASE 4B.1 — recovery: two consecutive deliveries of the SAME event.id', () => {
  const recoveryEvent = {
    id: 'evt_initial_purchase_recovery_001',
    type: 'INITIAL_PURCHASE',
    event_timestamp_ms: Date.parse('2026-08-11T12:00:00.000Z'),
    app_user_id: 'firebase-uid-recovery',
    product_id: 'ajfit_premium_monthly',
    period_type: 'TRIAL',
    expiration_at_ms: Date.parse('2026-08-18T12:00:00.000Z'),
    store: 'APP_STORE',
    entitlement_ids: ['premium'],
  };

  beforeEach(() => {
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
    vi.clearAllMocks();
    identityMocks.resolveRevenueCatFirebaseUid.mockResolvedValue({
      status: 'resolved',
      uid: 'firebase-uid-recovery',
      source: 'direct',
      customerIds: [],
    });
    subscriptionSyncMocks.validateSubscriptionPayload.mockImplementation((payload: unknown) => ({
      ok: true,
      data: payload,
    }));
  });

  it('C: delivery 1 (processed + attribution failure → 503) then delivery 2 (duplicate + attribution success → 200), confirming the timestamp exactly once', async () => {
    // ENTREGA 1: billing writes successfully; attribution hits a transient failure.
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValueOnce({
      status: 'processed',
    });
    attributionSyncMocks.applyAttributionRevenueCatEvent.mockRejectedValueOnce(
      new Error('transient firestore error'),
    );

    const firstDelivery = await invoke({ api_version: '1.0', event: recoveryEvent });

    expect(firstDelivery.statusCode()).toBe(503);
    expect(firstDelivery.body()).toEqual({ error: 'attribution_temporary_failure' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).toHaveBeenCalledTimes(1);
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).toHaveBeenCalledTimes(1);

    // ENTREGA 2: RevenueCat retries the SAME event.id. Billing correctly
    // recognizes it as already applied (duplicate — no second subscription
    // write). Attribution, evaluated independently, succeeds this time.
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValueOnce({
      status: 'duplicate',
    });
    attributionSyncMocks.applyAttributionRevenueCatEvent.mockResolvedValueOnce({
      status: 'confirmed',
    });

    const secondDelivery = await invoke({ api_version: '1.0', event: recoveryEvent });

    expect(secondDelivery.statusCode()).toBe(200);
    expect(secondDelivery.body()).toEqual({ status: 'duplicate' });

    // D: a THIRD delivery (another duplicate + already-confirmed attribution)
    // must not write anything new and must still resolve to 200.
    subscriptionSyncMocks.applySubscriptionEventAtomically.mockResolvedValueOnce({
      status: 'duplicate',
    });
    attributionSyncMocks.applyAttributionRevenueCatEvent.mockResolvedValueOnce({
      status: 'skipped',
      reason: 'locked',
    });

    const thirdDelivery = await invoke({ api_version: '1.0', event: recoveryEvent });

    expect(thirdDelivery.statusCode()).toBe(200);
    expect(thirdDelivery.body()).toEqual({ status: 'duplicate' });

    // Across all three deliveries: billing was asked to write 3 times (its
    // own idempotency — tested separately in subscriptionSync's suite —
    // guarantees only the first actually persists); attribution was asked
    // 3 times, and `applyAttributionRevenueCatEvent`'s own transaction
    // (tested in attribution/__tests__/revenueCatConfirmation.test.ts) is
    // what guarantees `lockedAt`/`trialStartedAt` are written exactly once
    // — confirmed here by the fact each call received the SAME
    // eventTimestampMs (the source event never changes across retries).
    for (const call of attributionSyncMocks.applyAttributionRevenueCatEvent.mock.calls) {
      expect(call[1]).toMatchObject({ eventTimestampMs: recoveryEvent.event_timestamp_ms });
    }
  });
});
