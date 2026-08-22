import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `handleAccountDeletionRequested` is the testable core behind the
 * `onDocumentCreated` trigger in `immediateDispatch.ts`. `processAccountDeletionRecord`
 * (Fase 14, already exhaustively tested in `reconciliation/__tests__/processRecord.test.ts`)
 * is mocked here so these tests isolate exactly what THIS file adds: calling
 * that engine with a fresh ownerId, and never swallowing an exception the
 * platform needs to see in order to retry delivery.
 */
const processAccountDeletionRecord = vi.hoisted(() => vi.fn());
vi.mock('../reconciliation/processRecord', () => ({ processAccountDeletionRecord }));

import { handleAccountDeletionRequested } from '../immediateDispatch';

afterEach(() => {
  vi.clearAllMocks();
});

describe('handleAccountDeletionRequested', () => {
  it('A: calls processAccountDeletionRecord for the triggering deletionId with a fresh ownerId', async () => {
    processAccountDeletionRecord.mockResolvedValue({ kind: 'PROGRESSED', stepsExecuted: 5, finalStatus: 'PROCESSING' });

    await handleAccountDeletionRequested('del-1');

    expect(processAccountDeletionRecord).toHaveBeenCalledTimes(1);
    const [deletionId, options] = processAccountDeletionRecord.mock.calls[0];
    expect(deletionId).toBe('del-1');
    expect(typeof options.ownerId).toBe('string');
    expect(options.ownerId.length).toBeGreaterThan(0);
  });

  it('two invocations (simulating two Eventarc redeliveries, or an immediate+scheduler race) never share an ownerId', async () => {
    processAccountDeletionRecord.mockResolvedValue({ kind: 'LEASE_HELD' });

    await handleAccountDeletionRequested('del-1');
    await handleAccountDeletionRequested('del-1');

    const [firstOwnerId] = [processAccountDeletionRecord.mock.calls[0][1].ownerId];
    const [secondOwnerId] = [processAccountDeletionRecord.mock.calls[1][1].ownerId];
    expect(firstOwnerId).not.toBe(secondOwnerId);
  });

  it('C: rethrows on failure so Eventarc may redeliver — never swallows the error into a silent no-op', async () => {
    const boom = new Error('transient infra failure');
    processAccountDeletionRecord.mockRejectedValue(boom);

    await expect(handleAccountDeletionRequested('del-1')).rejects.toThrow('transient infra failure');
  });

  it('H: a non-throwing ALREADY_TERMINAL outcome (e.g. a redelivered event for an already-COMPLETED record) resolves cleanly — no retry triggered', async () => {
    processAccountDeletionRecord.mockResolvedValue({ kind: 'ALREADY_TERMINAL', status: 'COMPLETED' });

    await expect(handleAccountDeletionRequested('del-1')).resolves.toBeUndefined();
  });

  it('a legitimate RETRY_SCHEDULED outcome resolves cleanly — backoff timing stays owned by the step/scheduler, not by Eventarc redelivery', async () => {
    processAccountDeletionRecord.mockResolvedValue({ kind: 'PROGRESSED', stepsExecuted: 1, finalStatus: 'RETRY_SCHEDULED' });

    await expect(handleAccountDeletionRequested('del-1')).resolves.toBeUndefined();
  });
});
