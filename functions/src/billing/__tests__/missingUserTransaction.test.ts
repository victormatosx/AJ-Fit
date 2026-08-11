import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../lib/firebaseAdmin', () => ({
  db: {
    doc: vi.fn(() => ({ path: 'users/firebase-deleted' })),
    runTransaction: vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) =>
      operation(transactionMocks),
    ),
  },
  auth: { getUser: vi.fn() },
}));

import { applySubscriptionEventAtomically } from '../subscriptionSync';

describe('applySubscriptionEventAtomically missing-user guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never recreates users/{uid} if the document disappeared before the transaction', async () => {
    transactionMocks.get.mockResolvedValue({ exists: false });

    const result = await applySubscriptionEventAtomically(
      'firebase-deleted',
      'event-after-delete',
      1_786_400_000_000,
      { provider: 'REVENUECAT', entitlementActive: true },
    );

    expect(result).toEqual({ status: 'user_not_found' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
    expect(transactionMocks.update).not.toHaveBeenCalled();
  });

  it('replaces the subscription map for a current-state TRANSFER snapshot', async () => {
    transactionMocks.get.mockResolvedValue({
      exists: true,
      get: vi.fn(() => ({ lastEventId: 'older', lastEventTimestampMs: 100 })),
    });

    const result = await applySubscriptionEventAtomically(
      'firebase-current',
      'transfer-newer',
      200,
      { provider: 'REVENUECAT', entitlementActive: false },
      { replaceSubscription: true },
    );

    expect(result).toEqual({ status: 'processed' });
    expect(transactionMocks.update).toHaveBeenCalledWith(
      expect.any(Object),
      {
        subscription: expect.objectContaining({
          provider: 'REVENUECAT',
          entitlementActive: false,
          lastEventId: 'transfer-newer',
          lastEventTimestampMs: 200,
          updatedAt: expect.anything(),
        }),
      },
    );
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it.each([
    ['duplicate', 'transfer-same', 200, 'transfer-same', 200],
    ['stale', 'transfer-old', 100, 'commercial-new', 200],
  ] as const)(
    'does not write a %s replacement snapshot',
    async (expectedStatus, eventId, eventTimestampMs, currentEventId, currentTimestampMs) => {
      transactionMocks.get.mockResolvedValue({
        exists: true,
        get: vi.fn(() => ({
          lastEventId: currentEventId,
          lastEventTimestampMs: currentTimestampMs,
        })),
      });

      const result = await applySubscriptionEventAtomically(
        'firebase-current',
        eventId,
        eventTimestampMs,
        { provider: 'REVENUECAT', entitlementActive: true },
        { replaceSubscription: true },
      );

      expect(result).toEqual({ status: expectedStatus });
      expect(transactionMocks.set).not.toHaveBeenCalled();
      expect(transactionMocks.update).not.toHaveBeenCalled();
    },
  );
});
