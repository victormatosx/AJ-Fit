import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook = readFileSync(new URL('../useWorkoutSchedule.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../services/workoutSchedule.ts', import.meta.url), 'utf8');

describe('terminal Execution -> pending Schedule process-death recovery', () => {
  it('does not use AsyncStorage or the cleared current mutex as completion authority', () => {
    const recovery = hook.slice(hook.indexOf('// Process-death recovery, case B:'), hook.indexOf('const timezone ='));
    expect(recovery).toContain('listExecutionsForProgram');
    expect(recovery).toContain('hasScheduledSessionCompletion');
    expect(recovery).not.toContain('AsyncStorage');
    expect(recovery).not.toContain('loadActiveExecutionPointer');
  });

  it('only considers COMPLETED/PARTIALLY_COMPLETED, never IN_PROGRESS or ABANDONED', () => {
    const selector = hook.slice(hook.indexOf('export function terminalExecutionForScheduleRecovery'), hook.indexOf('export interface WorkoutScheduleController'));
    expect(selector).toContain("item.status === 'COMPLETED'");
    expect(selector).toContain("item.status === 'PARTIALLY_COMPLETED'");
    expect(selector).not.toContain("item.status === 'IN_PROGRESS'");
    expect(selector).not.toContain("item.status === 'ABANDONED'");
  });

  it('checks the exact durable Schedule event before idempotently resuming completion', () => {
    expect(service).toContain('export async function hasScheduledSessionCompletion');
    const recovery = hook.slice(hook.indexOf('// Process-death recovery, case B:'), hook.indexOf('const timezone ='));
    expect(recovery).toContain('await finalizeWorkoutSession({ executionId: candidate.executionId })');
    expect(recovery).toContain('candidate.scheduledLocalDate');
    expect(recovery).toContain('candidate.sessionIndex');
  });

  it('fails closed and leaves a missing Schedule fact retryable on cold start/foreground', () => {
    const recovery = hook.slice(hook.indexOf('// Process-death recovery, case B:'), hook.indexOf('const timezone ='));
    expect(recovery).toContain("'terminal_execution_schedule_recovery_failed'");
    expect(hook).toContain("AppState.addEventListener('change'");
  });

  it('uses the atomic finalizer instead of the legacy Schedule grant pipeline', () => {
    const recovery = hook.slice(hook.indexOf('// Process-death recovery, case B:'), hook.indexOf('const timezone ='));
    expect(recovery).toContain('finalizeWorkoutSession');
    expect(recovery).not.toContain('authorizeWorkoutLifecycleMutation');
  });

  it('recognizes a committed Schedule event before invoking recovery', () => {
    const recovery = hook.slice(hook.indexOf('// Process-death recovery, case B:'), hook.indexOf('const timezone ='));
    expect(recovery.indexOf('hasScheduledSessionCompletion')).toBeLessThan(recovery.indexOf('finalizeWorkoutSession'));
  });

  it('checks the candidate\'s own occurrence, never implicitly occurrence 1 (audit regression)', () => {
    // A `flexible` schedule's same-day occurrence 2+ has its own distinct
    // COMPLETED event id. Omitting `occurrence` here made every recovery
    // check fall back to occurrence 1's id, silently skipping recovery for a
    // terminal occurrence 2+ execution whenever an earlier occurrence that
    // same day had already completed.
    const recovery = hook.slice(hook.indexOf('// Process-death recovery, case B:'), hook.indexOf('const timezone ='));
    expect(recovery).toContain('candidate.occurrence');
    expect(recovery.indexOf('candidate.occurrence')).toBeLessThan(recovery.indexOf('finalizeWorkoutSession'));
  });
});
