/**
 * Fase 9 gate — RevenueCat webhook fail-closed proof, specifically framed
 * around account deletion (not a general robustness test — those already
 * exist in `webhookHandler.test.ts`/`missingUserTransaction.test.ts` and are
 * NOT duplicated here).
 *
 * Scenario this file proves: a Firebase account was deleted (its
 * `users/{uid}` Firestore document AND its Firebase Auth user are both
 * gone — `validFirebaseUserExists` returns `false` for both, matching what
 * Fases 5/6 actually leave behind after `ACCOUNT_ACCESS_LOCK` +
 * `AUTH_DELETION`/`FIRESTORE_CLEANUP` complete). RevenueCat, unaware of the
 * deletion (policy v1: `revenueCat = SKIP` — this backend never tells
 * RevenueCat about the deletion), later delivers a webhook event still
 * referencing that uid. The webhook must NEVER resurrect ANY trace of the
 * deleted account.
 *
 * The production code under test (`../revenuecat.ts`, `../subscriptionSync.ts`,
 * `../revenueCatIdentity.ts`) was NOT modified for this phase — this file
 * only adds coverage. See the Fase 9 report's audit section for the full
 * trace of why this is already fail-closed by construction.
 */
import * as crypto from 'crypto';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const subscriptionSyncMocks = vi.hoisted(() => ({
  applySubscriptionEventAtomically: vi.fn(),
  validFirebaseUserExists: vi.fn(),
  validateSubscriptionPayload: vi.fn(),
}));

const revenueCatApiMocks = vi.hoisted(() => ({
  createRevenueCatV2Client: vi.fn(),
}));

const attributionSyncMocks = vi.hoisted(() => ({
  applyAttributionRevenueCatEvent: vi.fn(),
}));

vi.mock('../subscriptionSync', () => subscriptionSyncMocks);
vi.mock('../revenueCatApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../revenueCatApi')>();
  return { ...actual, createRevenueCatV2Client: revenueCatApiMocks.createRevenueCatV2Client };
});
vi.mock('../../attribution/attributionSync', () => attributionSyncMocks);

import { handleRevenueCatWebhook } from '../revenuecat';

const SECRET = 'test-signing-secret';

function sign(timestampSeconds: number, rawBody: Buffer): string {
  const signedPayload = Buffer.concat([Buffer.from(`${timestampSeconds}.`, 'utf8'), rawBody]);
  const hex = crypto.createHmac('sha256', SECRET).update(signedPayload).digest('hex');
  return `t=${timestampSeconds},v1=${hex}`;
}

function makeRequest(body: unknown): Request {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = sign(Math.floor(Date.now() / 1000), rawBody);
  return {
    method: 'POST',
    body,
    rawBody,
    get: vi.fn((header: string) =>
      header.toLowerCase() === 'x-revenuecat-webhook-signature' ? signature : undefined,
    ),
  } as unknown as Request;
}

function makeResponse(): { response: Response; statusCode: () => number; body: () => unknown } {
  let statusCode = 200;
  let responseBody: unknown;
  const response = {
    status: vi.fn((next: number) => {
      statusCode = next;
      return response;
    }),
    json: vi.fn((next: unknown) => {
      responseBody = next;
      return response;
    }),
  } as unknown as Response;
  return { response, statusCode: () => statusCode, body: () => responseBody };
}

async function invoke(body: unknown) {
  const res = makeResponse();
  await handleRevenueCatWebhook(makeRequest(body), res.response);
  return res;
}

const DELETED_UID = 'deleted-account-uid';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
  // The heart of the scenario: `users/{uid}` AND Firebase Auth are BOTH
  // gone for this uid, for every candidate this test ever presents —
  // matching real post-deletion state, never a partial/ambiguous one.
  subscriptionSyncMocks.validFirebaseUserExists.mockResolvedValue(false);
  // No RevenueCat V2 identity graph evidence either — a deleted account has
  // no reason to still resolve via alias/search.
  revenueCatApiMocks.createRevenueCatV2Client.mockReturnValue({
    getCustomerIdentityGraph: vi.fn().mockResolvedValue({ customerIds: [], aliases: [] }),
    getCustomerSubscriptions: vi.fn(),
  });
});

describe('late RENEWAL for a deleted account', () => {
  const lateRenewal = {
    id: 'evt-late-renewal-001',
    type: 'RENEWAL',
    event_timestamp_ms: Date.parse('2026-08-19T12:00:00.000Z'),
    app_user_id: DELETED_UID,
    product_id: 'ajfit_premium_monthly',
    period_type: 'NORMAL',
    expiration_at_ms: Date.parse('2026-09-19T12:00:00.000Z'),
    store: 'APP_STORE',
    entitlement_ids: ['premium'],
  };

  it('never resolves identity, never writes, responds 200 ignored', async () => {
    const res = await invoke({ api_version: '1.0', event: lateRenewal });

    expect(res.statusCode()).toBe(200);
    expect(res.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });

  it('never confirms/locks a coupon-redemption attribution for the deleted uid', async () => {
    await invoke({ api_version: '1.0', event: lateRenewal });
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).not.toHaveBeenCalled();
  });

  it('two consecutive deliveries of the same late event are both safely ignored — no accumulation', async () => {
    const first = await invoke({ api_version: '1.0', event: lateRenewal });
    const second = await invoke({ api_version: '1.0', event: lateRenewal });

    expect(first.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
    expect(second.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });
});

describe('late INITIAL_PURCHASE for a deleted account', () => {
  it('never resolves identity, never writes, never treated as a fresh signup', async () => {
    const res = await invoke({
      api_version: '1.0',
      event: {
        id: 'evt-late-initial-001',
        type: 'INITIAL_PURCHASE',
        event_timestamp_ms: Date.parse('2026-08-19T12:00:00.000Z'),
        app_user_id: DELETED_UID,
        product_id: 'ajfit_premium_annual',
        period_type: 'NORMAL',
        expiration_at_ms: Date.parse('2027-08-19T12:00:00.000Z'),
        store: 'PLAY_STORE',
        entitlement_ids: ['premium'],
      },
    });

    expect(res.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
    expect(attributionSyncMocks.applyAttributionRevenueCatEvent).not.toHaveBeenCalled();
  });
});

describe('late CANCELLATION/EXPIRATION for a deleted account (no premium re-check possible either)', () => {
  it.each(['CANCELLATION', 'EXPIRATION'] as const)('%s never writes', async (type) => {
    const res = await invoke({
      api_version: '1.0',
      event: {
        id: `evt-late-${type.toLowerCase()}`,
        type,
        event_timestamp_ms: Date.parse('2026-08-19T12:00:00.000Z'),
        app_user_id: DELETED_UID,
        entitlement_ids: ['premium'],
      },
    });

    expect(res.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });
});

describe('late TRANSFER referencing a deleted account', () => {
  it('deleted uid as TRANSFER destination: never reconciled, never written', async () => {
    const res = await invoke({
      api_version: '1.0',
      event: {
        id: 'evt-late-transfer-dest',
        type: 'TRANSFER',
        event_timestamp_ms: Date.parse('2026-08-19T12:00:00.000Z'),
        transferred_from: ['some-other-live-uid'],
        transferred_to: [DELETED_UID],
        environment: 'SANDBOX',
      },
    });

    expect(res.statusCode()).toBe(200);
    expect(res.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });

  it('deleted uid as TRANSFER source: destination side (if any) never leaks the deleted identity as evidence', async () => {
    const res = await invoke({
      api_version: '1.0',
      event: {
        id: 'evt-late-transfer-source',
        type: 'TRANSFER',
        event_timestamp_ms: Date.parse('2026-08-19T12:00:00.000Z'),
        transferred_from: [DELETED_UID],
        transferred_to: [],
        environment: 'SANDBOX',
      },
    });

    // No destination at all: acknowledged, ignored, no reconciliation of
    // either side is ever attempted (`handleTransferEvent`'s own early
    // return for an empty `transferred_to`).
    expect(res.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });
});

describe('RevenueCat customer still exists, but the AJ Fit account does not (Fase 9 §55/§56)', () => {
  it('an active-subscription RENEWAL for a deleted uid never recreates the AJ Fit account', async () => {
    // Even if RevenueCat's own customer record and store subscription are
    // still fully alive (policy v1 = SKIP: this backend never deletes/
    // touches the RevenueCat customer) — `validFirebaseUserExists` staying
    // false for the deleted uid is the ONLY signal this backend needs to
    // refuse recreation. RevenueCat customer existence carries zero
    // authority over AJ Fit account existence.
    const res = await invoke({
      api_version: '1.0',
      event: {
        id: 'evt-late-renewal-active-subscription',
        type: 'RENEWAL',
        event_timestamp_ms: Date.parse('2026-08-19T12:00:00.000Z'),
        app_user_id: DELETED_UID,
        product_id: 'ajfit_premium_monthly',
        period_type: 'NORMAL',
        expiration_at_ms: Date.parse('2026-09-19T12:00:00.000Z'),
        store: 'APP_STORE',
        entitlement_ids: ['premium'],
      },
    });

    expect(res.body()).toEqual({ status: 'ignored', reason: 'identity_unresolved' });
    expect(subscriptionSyncMocks.applySubscriptionEventAtomically).not.toHaveBeenCalled();
  });
});
