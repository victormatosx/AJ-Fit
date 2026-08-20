import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RevenueCatSubscription, RevenueCatSubscriptionApi } from '../revenueCatApi';
import { RevenueCatApiError } from '../revenueCatApi';

/**
 * Regression coverage for the second, synchronous line of defense for
 * `metadata.commercialGateResolvedAt` — see `confirmCommercialGate.ts`'s
 * module doc comment for the full security model. This suite exercises the
 * pure orchestration function (`confirmCommercialGateEntitlement`), not the
 * `onCall` HTTP wrapper — auth/active-account enforcement is already
 * covered by `requireAuth`/`requireActiveAccount`'s own tests, reused
 * as-is here.
 */

const transactionMocks = vi.hoisted(() => ({ set: vi.fn() }));

function mockSnapshot(commercialGateResolvedAt: unknown, exists = true) {
  return {
    exists,
    get: (path: string) => {
      if (path === 'metadata.commercialGateResolvedAt') return commercialGateResolvedAt;
      throw new Error(`unexpected snapshot.get path in test: ${path}`);
    },
  };
}

let nextSnapshot: ReturnType<typeof mockSnapshot> = mockSnapshot(null);

vi.mock('../../lib/firebaseAdmin', () => ({
  db: {
    doc: vi.fn(() => ({ path: 'users/uid-1' })),
    runTransaction: vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) =>
      operation({ get: async () => nextSnapshot, ...transactionMocks }),
    ),
  },
  auth: { getUser: vi.fn() },
}));

import { confirmCommercialGateEntitlement } from '../confirmCommercialGate';

function subscription(
  id: string,
  overrides: Partial<RevenueCatSubscription> = {},
): RevenueCatSubscription {
  return {
    id,
    customerId: 'uid-1',
    originalCustomerId: 'uid-1',
    productId: 'prod-monthly',
    startsAtMs: 1_000,
    currentPeriodStartsAtMs: 2_000,
    currentPeriodEndsAtMs: 3_000,
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

function fakeApi(
  impl: (uid: string) => Promise<RevenueCatSubscription[]>,
): RevenueCatSubscriptionApi {
  return {
    getCustomerIdentityGraph: vi.fn(),
    getCustomerSubscriptions: vi.fn(impl),
  };
}

describe('confirmCommercialGateEntitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextSnapshot = mockSnapshot(null);
  });

  it('1) conta nova + compra confirmada pelo RevenueCat → marker resolvido', async () => {
    const api = fakeApi(async () => [subscription('sub-1')]);

    const result = await confirmCommercialGateEntitlement('uid-1', api);

    expect(result).toEqual({ status: 'resolved' });
    expect(transactionMocks.set).toHaveBeenCalledWith(
      expect.any(Object),
      { 'metadata.commercialGateResolvedAt': expect.anything() },
      { merge: true },
    );
  });

  it('2) conta nova + restore confirmado (mesma entitlement real, caminho idêntico) → marker resolvido', async () => {
    // Restore não é um tipo de evento diferente aqui — o RevenueCat V2 API
    // reporta o MESMO estado de assinatura ativa independentemente de como
    // o cliente chegou a ele (purchase vs restore). Esta é a prova de que
    // o caminho de restore não precisa de nenhuma lógica adicional.
    const api = fakeApi(async () => [subscription('sub-restored')]);

    const result = await confirmCommercialGateEntitlement('uid-1', api);

    expect(result).toEqual({ status: 'resolved' });
  });

  it('3) cliente "mente"/solicita confirmação sem entitlement real → marker continua null, sem escrita', async () => {
    const api = fakeApi(async () => [subscription('sub-1', { givesAccess: false, status: 'expired' })]);

    const result = await confirmCommercialGateEntitlement('uid-1', api);

    expect(result).toEqual({ status: 'not_entitled' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('3b) nenhuma assinatura Premium encontrada → not_entitled, sem escrita', async () => {
    const api = fakeApi(async () => []);

    const result = await confirmCommercialGateEntitlement('uid-1', api);

    expect(result).toEqual({ status: 'not_entitled' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('4) RevenueCat indisponível → marker continua null, estado recuperável (webhook ainda pode resolver depois)', async () => {
    const api = fakeApi(async () => {
      throw new RevenueCatApiError('temporary', 503);
    });

    const result = await confirmCommercialGateEntitlement('uid-1', api);

    expect(result).toEqual({ status: 'revenuecat_unavailable' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('5) webhook chega primeiro (marker já é Timestamp) → confirmação síncrona posterior é no-op', async () => {
    nextSnapshot = mockSnapshot({ seconds: 111, nanoseconds: 0 });
    const api = fakeApi(async () => [subscription('sub-1')]);

    const result = await confirmCommercialGateEntitlement('uid-1', api);

    expect(result).toEqual({ status: 'already_resolved' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('6) confirmação síncrona chega primeiro (marker vira Timestamp) — webhook subsequente já é coberto por subscriptionSync.test (idempotência simétrica)', async () => {
    nextSnapshot = mockSnapshot(null);
    const api = fakeApi(async () => [subscription('sub-1')]);

    const result = await confirmCommercialGateEntitlement('uid-1', api);
    expect(result).toEqual({ status: 'resolved' });
    // A simetria (webhook depois de sync = no-op) é a mesma condição
    // `current !== null` testada em subscriptionSync's
    // commercialGateResolution.test.ts — os dois lados escrevem através do
    // mesmo predicado, então provar um lado prova a convergência dos dois.
  });

  it('7) assinatura expira depois — fora do escopo desta função: nada aqui jamais lê/escreve com base em expiração, apenas em entitlement ATIVO no momento da chamada', async () => {
    const api = fakeApi(async () => [subscription('sub-1', { givesAccess: false, status: 'expired' })]);
    nextSnapshot = mockSnapshot({ seconds: 111, nanoseconds: 0 });

    const result = await confirmCommercialGateEntitlement('uid-1', api);

    // not_entitled short-circuits before ever reading the transaction —
    // proves a later expiration cannot even reach the write path, let alone
    // revert an already-resolved marker.
    expect(result).toEqual({ status: 'not_entitled' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('8) conta legada sem o campo (ausente) → already_resolved, sem escrita (evita migração desnecessária por login/compra)', async () => {
    nextSnapshot = mockSnapshot(undefined);
    const api = fakeApi(async () => [subscription('sub-1')]);

    const result = await confirmCommercialGateEntitlement('uid-1', api);

    expect(result).toEqual({ status: 'already_resolved' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('múltiplas assinaturas Premium ativas simultaneamente → ambiguous, sem escrita', async () => {
    const api = fakeApi(async () => [
      subscription('sub-a'),
      subscription('sub-b', { id: 'sub-b' }),
    ]);

    const result = await confirmCommercialGateEntitlement('uid-1', api);

    expect(result).toEqual({ status: 'ambiguous' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('documento do usuário não existe → user_not_found, sem escrita', async () => {
    nextSnapshot = mockSnapshot(null, false);
    const api = fakeApi(async () => [subscription('sub-1')]);

    const result = await confirmCommercialGateEntitlement('uid-1', api);

    expect(result).toEqual({ status: 'user_not_found' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('9) consulta sempre o uid do request.auth — nunca um uid de outro usuário (garantido pelo assinatura da função, não por dado do cliente)', async () => {
    const api = fakeApi(async (uid) => {
      expect(uid).toBe('uid-1');
      return [subscription('sub-1')];
    });

    await confirmCommercialGateEntitlement('uid-1', api);
    expect(api.getCustomerSubscriptions).toHaveBeenCalledWith('uid-1');
  });
});
