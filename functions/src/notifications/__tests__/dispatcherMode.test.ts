import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claimDispatch: vi.fn(),
  markDispatchOutcome: vi.fn(),
  loadEligibleDevices: vi.fn(),
}));

vi.mock('../idempotency', async (importOriginal) => ({
  ...await importOriginal<typeof import('../idempotency')>(),
  claimDispatch: mocks.claimDispatch,
  markDispatchOutcome: mocks.markDispatchOutcome,
}));
vi.mock('../deviceEligibility', async (importOriginal) => ({
  ...await importOriginal<typeof import('../deviceEligibility')>(),
  loadEligibleDevices: mocks.loadEligibleDevices,
}));

import { buildQaPreviewNotification } from '../contentPolicy';
import { dispatchNotification, type DispatcherDependencies } from '../dispatcher';

const NOW = Timestamp.fromMillis(2_000_000_000_000);
const REQUEST = buildQaPreviewNotification({
  uid: 'admin-uid',
  type: 'EVOLUTION_APPROACHING',
  qaRequestId: '10000000-0000-4000-8000-000000000001',
  locale: 'pt-BR',
});

function dependencies(preflight: NonNullable<DispatcherDependencies['preflight']>): DispatcherDependencies {
  return {
    db: {} as never,
    expoClient: { send: vi.fn() } as never,
    now: () => NOW,
    preflight,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimDispatch.mockResolvedValue({
    outcome: 'CLAIMED', dispatchId: 'dispatch-1', attemptCount: 1, claimToken: 'claim-1',
  });
  mocks.markDispatchOutcome.mockResolvedValue(true);
  mocks.loadEligibleDevices.mockResolvedValue({
    eligible: [], scannedCount: 0, scanLimitReached: false,
  });
});

describe('dispatcher mode boundary', () => {
  it('PRODUCT still applies canonical product preflight', async () => {
    const preflight = vi.fn(async () => ({
      allowed: false as const, reason: 'EVOLUTION_UNLOCKED_PRIORITY',
    }));
    await expect(dispatchNotification(REQUEST, dependencies(preflight), 'PRODUCT'))
      .resolves.toEqual({ status: 'SUPPRESSED_BY_POLICY', dispatchId: 'dispatch-1' });
    expect(preflight).toHaveBeenCalledOnce();
    expect(mocks.loadEligibleDevices).not.toHaveBeenCalled();
  });

  it('QA_PREVIEW skips only product-fact preflight and continues device eligibility', async () => {
    const preflight = vi.fn(async () => ({
      allowed: false as const, reason: 'EVOLUTION_UNLOCKED_PRIORITY',
    }));
    await expect(dispatchNotification(REQUEST, dependencies(preflight), 'QA_PREVIEW'))
      .resolves.toEqual({ status: 'NO_ELIGIBLE_DEVICE', dispatchId: 'dispatch-1' });
    expect(preflight).not.toHaveBeenCalled();
    expect(mocks.loadEligibleDevices).toHaveBeenCalledWith('admin-uid', expect.anything(), NOW);
    expect(mocks.claimDispatch).toHaveBeenCalledWith(
      expect.anything(), REQUEST, NOW, 'QA_PREVIEW',
    );
  });
});
