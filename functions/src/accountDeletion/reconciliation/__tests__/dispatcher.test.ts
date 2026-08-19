import { afterEach, describe, expect, it, vi } from 'vitest';

const lockAccountAccess = vi.hoisted(() => vi.fn());
const executeVaultKeyDestruction = vi.hoisted(() => vi.fn());
const runFirestoreCleanup = vi.hoisted(() => vi.fn());
const runStorageCleanup = vi.hoisted(() => vi.fn());
const runRetainedDataProcessing = vi.hoisted(() => vi.fn());
const runRevenueCatProcessing = vi.hoisted(() => vi.fn());
const executeAuthDeletion = vi.hoisted(() => vi.fn());
const revokeAppleProvider = vi.hoisted(() => vi.fn());

vi.mock('../../accountAccessLock', () => ({ lockAccountAccess }));
vi.mock('../../vaultKeyDestruction', () => ({ executeVaultKeyDestruction }));
vi.mock('../../firestoreCleanup/engine', () => ({ runFirestoreCleanup }));
vi.mock('../../storageCleanup/engine', () => ({ runStorageCleanup }));
vi.mock('../../retainedDataProcessing/engine', () => ({ runRetainedDataProcessing }));
vi.mock('../../revenueCatProcessing/engine', () => ({ runRevenueCatProcessing }));
vi.mock('../../authDeletion', () => ({ executeAuthDeletion }));
vi.mock('../../providerRevocation/appleProviderRevocation', () => ({ revokeAppleProvider }));
vi.mock('../../providerRevocation/appleIdentityConfig', () => ({ createAppleIdentityClient: vi.fn() }));

import { createAccountDeletionRecord } from '../../record';
import { currentPolicy } from '../../policy';
import { runProviderSubStep, runTopLevelStep } from '../dispatcher';

const POLICY = currentPolicy();

afterEach(() => {
  vi.clearAllMocks();
});

function record() {
  return createAccountDeletionRecord({
    deletionId: 'del-1',
    uid: 'uid-1',
    policy: POLICY,
    now: 1000,
    requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
    linkedProviders: ['apple.com'],
  });
}

describe('runTopLevelStep', () => {
  it('routes each step name to exactly its own executor, passing the record uid', async () => {
    lockAccountAccess.mockResolvedValue({ kind: 'SUCCEEDED' });
    await runTopLevelStep('ACCOUNT_ACCESS_LOCK', record());
    expect(lockAccountAccess).toHaveBeenCalledWith('uid-1');

    executeVaultKeyDestruction.mockResolvedValue({ kind: 'SUCCEEDED' });
    await runTopLevelStep('VAULT_KEY_DESTRUCTION', record());
    expect(executeVaultKeyDestruction).toHaveBeenCalledWith('uid-1');

    runFirestoreCleanup.mockResolvedValue({ kind: 'SUCCEEDED' });
    await runTopLevelStep('FIRESTORE_CLEANUP', record());
    expect(runFirestoreCleanup).toHaveBeenCalledWith('uid-1');

    runStorageCleanup.mockResolvedValue({ kind: 'SUCCEEDED' });
    await runTopLevelStep('STORAGE_CLEANUP', record());
    expect(runStorageCleanup).toHaveBeenCalledWith('uid-1');

    executeAuthDeletion.mockResolvedValue({ kind: 'SUCCEEDED' });
    await runTopLevelStep('AUTH_DELETION', record());
    expect(executeAuthDeletion).toHaveBeenCalledWith('uid-1');
  });

  it('RETAINED_DATA_PROCESSING and REVENUECAT_PROCESSING always use the FROZEN record policy, never a re-resolved one', async () => {
    const r = record();
    runRetainedDataProcessing.mockResolvedValue({ kind: 'SKIPPED_BY_POLICY', reason: 'x' });
    await runTopLevelStep('RETAINED_DATA_PROCESSING', r);
    expect(runRetainedDataProcessing).toHaveBeenCalledWith('uid-1', r.policy.retention);

    runRevenueCatProcessing.mockResolvedValue({ kind: 'SKIPPED_BY_POLICY', reason: 'x' });
    await runTopLevelStep('REVENUECAT_PROCESSING', r);
    expect(runRevenueCatProcessing).toHaveBeenCalledWith(r.policy.retention.revenueCat);
  });
});

describe('runProviderSubStep', () => {
  it('Apple: always calls the real executor with authorizationCode null (worker never has fresh client material)', async () => {
    revokeAppleProvider.mockResolvedValue({ kind: 'SUCCEEDED' });
    const r = record();
    await runProviderSubStep('apple.com', r, {});
    expect(revokeAppleProvider).toHaveBeenCalledWith(
      { deletionId: 'del-1', expectedUid: 'uid-1', capturedForUid: 'uid-1', authorizationCode: null },
      expect.objectContaining({ repository: expect.anything(), wrap: expect.anything(), unwrap: expect.anything() }),
    );
  });

  it('Google: fails safely and terminally — no backend executor exists, never hangs, never invents a call', async () => {
    const outcome = await runProviderSubStep('google.com', record(), {});
    expect(outcome).toEqual({ kind: 'FAILED', code: 'MISSING_REQUIRED_CONFIGURATION' });
    expect(revokeAppleProvider).not.toHaveBeenCalled();
  });
});
