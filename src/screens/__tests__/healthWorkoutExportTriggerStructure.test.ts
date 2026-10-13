import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `WorkoutCompletionResult`'s `'COMPLETED'` value is a UI-flow discriminant
 * — "the callable succeeded and the backend committed a terminal execution"
 * — not the Firestore execution document's own `status` field, which is
 * `'COMPLETED' | 'PARTIALLY_COMPLETED'` (see `FinalizeWorkoutSessionResult`
 * in `services/finalizeWorkoutSession.ts`: its own `status` is *always* the
 * literal `'COMPLETED'`; the real per-session outcome lives in
 * `executionStatus`). The health-export trigger must fire on this UI-flow
 * result, not on a (nonexistent) literal match against the document status —
 * `isTerminalHealthWorkoutExecution` in `services/healthWorkoutExport.ts`
 * independently reloads the real document and accepts both statuses.
 */
const source = readFileSync(resolve(process.cwd(), 'src/screens/AppShell.tsx'), 'utf8');

describe('health workout export trigger — COMPLETED and PARTIALLY_COMPLETED wiring', () => {
  it('fires enqueueConfirmed only inside the `result === \'COMPLETED\'` branch of the finish flow', () => {
    const triggerIdx = source.indexOf('void healthWorkoutExport.enqueueConfirmed(executionId);');
    expect(triggerIdx).toBeGreaterThan(-1);
    const guardIdx = source.lastIndexOf("if (result === 'COMPLETED') {", triggerIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    // No other `if` between the guard and the trigger call — it isn't
    // additionally conditioned on the execution document's own status.
    const between = source.slice(guardIdx + "if (result === 'COMPLETED') {".length, triggerIdx);
    expect(between).not.toMatch(/executionStatus\s*===\s*'COMPLETED'/);
  });

  it('the lost-response reconciliation path preserves the real document status instead of hardcoding it', () => {
    const reconciliationIdx = source.indexOf('finalization_response_reconciled_from_authority');
    expect(reconciliationIdx).toBeGreaterThan(-1);
    const block = source.slice(source.lastIndexOf('finalized = {', reconciliationIdx), reconciliationIdx);
    // The outer `status` field is the UI-flow literal (always 'COMPLETED'
    // once reconciliation finds authority); `executionStatus` carries
    // whatever the backend actually wrote — COMPLETED or PARTIALLY_COMPLETED.
    expect(block).toContain("status: 'COMPLETED'");
    expect(block).toContain('executionStatus: terminal.status');
    expect(block).not.toContain("executionStatus: 'COMPLETED'");
  });
});
