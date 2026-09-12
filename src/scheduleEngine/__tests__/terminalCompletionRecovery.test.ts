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
    expect(recovery).toContain('await completeScheduledSession');
    expect(recovery).toContain('candidate.scheduledLocalDate');
    expect(recovery).toContain('candidate.sessionIndex');
  });

  it('fails closed and leaves a missing Schedule fact retryable on cold start/foreground', () => {
    const recovery = hook.slice(hook.indexOf('// Process-death recovery, case B:'), hook.indexOf('const timezone ='));
    expect(recovery).toContain("'terminal_execution_schedule_recovery_failed'");
    expect(hook).toContain("AppState.addEventListener('change'");
  });

  it('coalesces foreground recovery with an explicit retry only while the same Schedule fact is in flight', () => {
    expect(service).toContain('scheduledSessionCompletionsInFlight.get(key)');
    expect(service).toContain('scheduledSessionCompletionsInFlight.set(key, operation)');
    expect(service).toContain('scheduledSessionCompletionsInFlight.delete(key)');
    expect(service).toContain('void operation.then(release, release)');
  });

  it('recognizes a committed Schedule event before requesting another one-time grant', () => {
    const attempt = service.slice(
      service.indexOf('async function completeScheduledSessionAttempt'),
      service.indexOf('export async function resolveMissedSession'),
    );
    expect(attempt.indexOf('await getDoc(eventRef)')).toBeLessThan(
      attempt.indexOf('await authorizeWorkoutLifecycleMutation'),
    );
    expect(attempt).toContain('if ((await getDoc(eventRef)).exists()) return;');
  });
});
