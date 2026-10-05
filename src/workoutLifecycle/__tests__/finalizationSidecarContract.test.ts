import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const backend = readFileSync(
  new URL('../../../functions/src/workoutLifecycle/finalizeWorkoutSession.ts', import.meta.url),
  'utf8',
);
const shell = readFileSync(new URL('../../screens/AppShell.tsx', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../finalizationRuntime.ts', import.meta.url), 'utf8');
const execution = readFileSync(new URL('../../workoutExecution/useWorkoutExecution.ts', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
const indexes = readFileSync(new URL('../../../firestore.indexes.json', import.meta.url), 'utf8');
const cleanup = readFileSync(
  new URL('../../../functions/src/accountDeletion/firestoreCleanup/resources.ts', import.meta.url),
  'utf8',
);

describe('workout finalization sidecar contract', () => {
  it('emits real server checkpoints without awaiting sidecar writes in the authoritative path', () => {
    expect(backend).toContain("reportProgress('SERVER_ACCEPTED')");
    expect(backend).toContain("reportProgress('PREFLIGHT_VALIDATED')");
    expect(backend).toContain("reportProgress('COMMITTED')");
    expect(backend).not.toContain("await reportProgress('SERVER_ACCEPTED')");
    expect(backend).not.toContain("await reportProgress('PREFLIGHT_VALIDATED')");
    expect(backend).not.toContain("await reportProgress('COMMITTED')");
    expect(backend.indexOf("reportProgress('PREFLIGHT_VALIDATED')"))
      .toBeLessThan(backend.indexOf("mark(startedAt, 'transaction_start')"));
    expect(backend.indexOf("mark(startedAt, 'transaction_end', { success: true })"))
      .toBeLessThan(backend.indexOf("reportProgress('COMMITTED')"));
  });

  it('marks CLIENT_READY only after the mutation queue flush succeeds', () => {
    expect(execution.indexOf('await mutationQueueRef.current.flush()'))
      .toBeLessThan(execution.indexOf("progress?.onCheckpoint('CLIENT_READY')"));
  });

  it('forces COMMITTED from callable success and preserves exact retry input', () => {
    expect(shell).toContain("isAuthoritativelyCommitted: (result) => result === 'COMPLETED'");
    expect(runtime).toContain("if (committed) reportCheckpoint('COMMITTED')");
    expect(shell).toContain('retryInput.actualCardioDurationSeconds');
    expect(shell).toContain('retryInput.mode');
    expect(shell).toContain('finalization_response_reconciled_from_authority');
    expect(shell).toContain('hasScheduledSessionCompletion({');
  });

  it('keeps the sidecar server-owned, expiring and covered by account cleanup', () => {
    expect(rules).toContain('match /workoutFinalizationAttempts/{attemptId}');
    expect(rules).toMatch(/match \/workoutFinalizationAttempts\/\{attemptId\}[\s\S]*allow write: if false/);
    expect(indexes).toContain('"collectionGroup": "workoutFinalizationAttempts"');
    expect(indexes).toContain('"fieldPath": "expiresAt"');
    expect(cleanup).toContain('deleteUserWorkoutFinalizationAttempts');
  });
});
