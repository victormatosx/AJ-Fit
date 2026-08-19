import { afterEach, describe, expect, it, vi } from 'vitest';

const queryReconciliationCandidates = vi.hoisted(() => vi.fn());
const isRecordDueNow = vi.hoisted(() => vi.fn());
const processAccountDeletionRecord = vi.hoisted(() => vi.fn());

vi.mock('../recordAccess', () => ({ queryReconciliationCandidates, isRecordDueNow }));
vi.mock('../processRecord', () => ({
  processAccountDeletionRecord,
  DEFAULT_LEASE_DURATION_MS: 300_000,
  DEFAULT_MAX_STEPS_PER_INVOCATION: 5,
}));
vi.mock('../../requestAccountDeletion', () => ({ REQUEST_ACCOUNT_DELETION_SECRETS: [] }));

import { runReconciliationBatch } from '../scheduler';

function candidate(deletionId: string, uid = 'uid-x') {
  return { deletionId, uid, status: 'REQUESTED' } as never;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('runReconciliationBatch', () => {
  it('processes every due candidate and skips those not yet due, with zero executor calls for the skipped ones', async () => {
    queryReconciliationCandidates.mockResolvedValue([candidate('a'), candidate('b'), candidate('c')]);
    isRecordDueNow.mockImplementation((record: { deletionId: string }) => record.deletionId !== 'b');
    processAccountDeletionRecord.mockResolvedValue({ kind: 'PROGRESSED', stepsExecuted: 1, finalStatus: 'PROCESSING' });

    const result = await runReconciliationBatch({ batchSize: 25, concurrency: 5 });

    expect(result).toEqual({ candidateCount: 3, processed: 2, skipped: 1, errors: 0 });
    expect(processAccountDeletionRecord).toHaveBeenCalledTimes(2);
    expect(processAccountDeletionRecord).not.toHaveBeenCalledWith('b', expect.anything());
  });

  it('one broken record never aborts the batch — isolated per record, others still processed', async () => {
    queryReconciliationCandidates.mockResolvedValue([candidate('a'), candidate('b'), candidate('c')]);
    isRecordDueNow.mockReturnValue(true);
    processAccountDeletionRecord.mockImplementation(async (id: string) => {
      if (id === 'b') throw new Error('boom');
      return { kind: 'PROGRESSED', stepsExecuted: 1, finalStatus: 'PROCESSING' };
    });

    const result = await runReconciliationBatch({ batchSize: 25, concurrency: 5 });

    expect(result).toEqual({ candidateCount: 3, processed: 2, skipped: 0, errors: 1 });
  });

  it('never runs unbounded concurrency — at most `concurrency` in flight at once', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `del-${i}`);
    queryReconciliationCandidates.mockResolvedValue(ids.map((id) => candidate(id)));
    isRecordDueNow.mockReturnValue(true);

    let inFlight = 0;
    let maxInFlight = 0;
    processAccountDeletionRecord.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { kind: 'PROGRESSED', stepsExecuted: 1, finalStatus: 'PROCESSING' };
    });

    const result = await runReconciliationBatch({ batchSize: 25, concurrency: 3 });

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(result.processed).toBe(12);
  });

  it('a completely empty candidate set is a safe, zero-work no-op', async () => {
    queryReconciliationCandidates.mockResolvedValue([]);
    const result = await runReconciliationBatch();
    expect(result).toEqual({ candidateCount: 0, processed: 0, skipped: 0, errors: 0 });
    expect(processAccountDeletionRecord).not.toHaveBeenCalled();
  });

  it('never exceeds the requested batch size — bounded query, not a full scan', async () => {
    queryReconciliationCandidates.mockResolvedValue([candidate('a')]);
    isRecordDueNow.mockReturnValue(true);
    processAccountDeletionRecord.mockResolvedValue({ kind: 'PROGRESSED', stepsExecuted: 1, finalStatus: 'PROCESSING' });

    await runReconciliationBatch({ batchSize: 7 });
    expect(queryReconciliationCandidates).toHaveBeenCalledWith(7);
  });
});
