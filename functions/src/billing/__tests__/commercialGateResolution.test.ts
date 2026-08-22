import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for the initial-Paywall marker
 * (`metadata.commercialGateResolvedAt` — see the `UserProfile.metadata` doc
 * comment in src/services/userProfile.ts) resolved by
 * `applySubscriptionEventAtomically`. This is the ONLY backend write path
 * for this field — the client can only ever write it as `null` at account
 * creation (Firestore Rules enforce that, see firestore-tests).
 *
 * The transaction mock's `get` distinguishes by field path, unlike the
 * simpler mocks in missingUserTransaction.test.ts — needed here because
 * this module now reads two different paths off the same snapshot
 * (`subscription.*` for ordering, `metadata.commercialGateResolvedAt` for
 * the gate marker).
 *
 * This suite only proves WHICH mock method was invoked and with what plain
 * JS arguments — it cannot catch a bug where the argument shape is
 * "correct" JS but Firestore's real dot-path semantics store it wrong (that
 * class of bug is exactly what corrupted `users/{uid}` in production; see
 * this module's own doc comment on the gate write). The emulator-backed
 * proof that a real Firestore document ends up correctly nested — not just
 * that these mocks were called — lives in
 * `commercialGateResolution.integration.test.ts`.
 */

const transactionMocks = vi.hoisted(() => ({
  set: vi.fn(),
  update: vi.fn(),
}));

function mockSnapshot(options: {
  lastEventId?: string | null;
  lastEventTimestampMs?: number | null;
  commercialGateResolvedAt: unknown;
}) {
  const { lastEventId = null, lastEventTimestampMs = null, commercialGateResolvedAt } = options;
  return {
    exists: true,
    get: (path: string) => {
      // `commercialGateResolvedAt: undefined` is a deliberate, distinct test
      // case (an "absent field" legacy document) — must not collapse into
      // any default. `options` (not a destructured default) is what makes
      // that possible: JS default-parameter substitution only kicks in on
      // destructuring, which would otherwise silently turn `undefined` into
      // `null` here and hide the absent/pending distinction this suite
      // exists to cover.
      if (path === 'metadata.commercialGateResolvedAt') return commercialGateResolvedAt;
      if (path === 'subscription') return { lastEventId, lastEventTimestampMs };
      throw new Error(`unexpected snapshot.get path in test: ${path}`);
    },
  };
}

vi.mock('../../lib/firebaseAdmin', () => ({
  db: {
    doc: vi.fn(() => ({ path: 'users/uid-1' })),
    runTransaction: vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) =>
      operation(transactionMocks),
    ),
  },
  auth: { getUser: vi.fn() },
}));

import { applySubscriptionEventAtomically } from '../subscriptionSync';

describe('applySubscriptionEventAtomically — commercialGateResolvedAt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the gate the first time an event confirms entitlementActive: true for a still-pending (null) account, via a SEPARATE update() call — never merged into the set(...,{merge:true}) subscription write', async () => {
    (await import('../../lib/firebaseAdmin')).db.runTransaction = vi.fn(async (op) =>
      op({
        get: async () => mockSnapshot({ commercialGateResolvedAt: null }),
        ...transactionMocks,
      }),
    ) as never;

    await applySubscriptionEventAtomically('uid-1', 'evt-1', 1_000, {
      provider: 'REVENUECAT',
      entitlementActive: true,
    });

    // The subscription mirror write never carries the dotted gate key.
    expect(transactionMocks.set).toHaveBeenCalledWith(
      expect.any(Object),
      { subscription: expect.anything() },
      { merge: true },
    );
    const [, subscriptionPayload] = transactionMocks.set.mock.calls[0] ?? [];
    expect(subscriptionPayload).not.toHaveProperty('metadata.commercialGateResolvedAt');

    // The gate marker is written through `update()`, which is the only
    // Admin SDK operation that correctly parses a dotted string key as a
    // nested field path.
    expect(transactionMocks.update).toHaveBeenCalledWith(expect.any(Object), {
      'metadata.commercialGateResolvedAt': expect.anything(),
    });
  });

  it('does NOT touch the gate when the account already resolved it (existing Timestamp) — a later purchase never rewrites the original resolution', async () => {
    const alreadyResolvedAt = { seconds: 123, nanoseconds: 0 };
    (await import('../../lib/firebaseAdmin')).db.runTransaction = vi.fn(async (op) =>
      op({
        get: async () => mockSnapshot({ commercialGateResolvedAt: alreadyResolvedAt }),
        ...transactionMocks,
      }),
    ) as never;

    await applySubscriptionEventAtomically('uid-1', 'evt-2', 1_000, {
      provider: 'REVENUECAT',
      entitlementActive: true,
    });

    expect(transactionMocks.update).not.toHaveBeenCalled();
  });

  it('does NOT touch the gate when the account predates the field (absent — legacy, already treated as resolved client-side)', async () => {
    (await import('../../lib/firebaseAdmin')).db.runTransaction = vi.fn(async (op) =>
      op({
        get: async () => mockSnapshot({ commercialGateResolvedAt: undefined }),
        ...transactionMocks,
      }),
    ) as never;

    await applySubscriptionEventAtomically('uid-1', 'evt-3', 1_000, {
      provider: 'REVENUECAT',
      entitlementActive: true,
    });

    expect(transactionMocks.update).not.toHaveBeenCalled();
  });

  it('does NOT resolve the gate on an event that does not confirm an active entitlement (e.g. EXPIRATION)', async () => {
    (await import('../../lib/firebaseAdmin')).db.runTransaction = vi.fn(async (op) =>
      op({
        get: async () => mockSnapshot({ commercialGateResolvedAt: null }),
        ...transactionMocks,
      }),
    ) as never;

    await applySubscriptionEventAtomically('uid-1', 'evt-4', 1_000, {
      provider: 'REVENUECAT',
      entitlementActive: false,
    });

    expect(transactionMocks.update).not.toHaveBeenCalled();
  });
});
