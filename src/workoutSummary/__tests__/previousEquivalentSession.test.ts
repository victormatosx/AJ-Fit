import { describe, expect, it } from 'vitest';

import { findPreviousEquivalentExecution } from '../previousEquivalentSession';
import { buildExecution, completedSet, exercise } from './testFixtures';

describe('findPreviousEquivalentExecution', () => {
  it('picks the most recent OTHER execution with the same sessionIndex and programInstanceId', () => {
    const executions = [
      buildExecution({ executionId: 'push-1', programInstanceId: 'inst-1', sessionIndex: 0, scheduledLocalDate: '2026-08-01', exercises: [exercise('bench', 0, [completedSet(60, 10)])] }),
      buildExecution({ executionId: 'pull-1', programInstanceId: 'inst-1', sessionIndex: 1, scheduledLocalDate: '2026-08-02', exercises: [exercise('row', 0, [completedSet(40, 10)])] }),
      buildExecution({ executionId: 'push-2', programInstanceId: 'inst-1', sessionIndex: 0, scheduledLocalDate: '2026-08-08', exercises: [exercise('bench', 0, [completedSet(62.5, 10)])] }),
    ];

    const result = findPreviousEquivalentExecution(executions, {
      programId: 'program-1',
      programInstanceId: 'inst-1',
      sessionIndex: 0,
      excludeExecutionId: 'push-3',
    });

    expect(result?.executionId).toBe('push-2');
  });

  it('never matches a different sessionIndex, even in the same program instance (Push vs Pull)', () => {
    const executions = [
      buildExecution({ executionId: 'pull-1', programInstanceId: 'inst-1', sessionIndex: 1, scheduledLocalDate: '2026-08-02', exercises: [] }),
    ];

    const result = findPreviousEquivalentExecution(executions, {
      programId: 'program-1',
      programInstanceId: 'inst-1',
      sessionIndex: 0,
      excludeExecutionId: 'push-2',
    });

    expect(result).toBeNull();
  });

  it('falls back to programId matching for legacy executions with no programInstanceId', () => {
    const executions = [
      buildExecution({ executionId: 'legacy-1', programId: 'legacy-program', sessionIndex: 0, scheduledLocalDate: '2026-07-01', exercises: [] }),
    ];

    const result = findPreviousEquivalentExecution(executions, {
      programId: 'legacy-program',
      sessionIndex: 0,
      excludeExecutionId: 'legacy-2',
    });

    expect(result?.executionId).toBe('legacy-1');
  });

  // 2026-10 fix: flexible schedules can produce several same-day executions
  // of the same sessionIndex (occurrence 1, 2, 3...) — `performedLocalDate`
  // alone can no longer totally order them (all three share the same date).
  it('picks occurrence 2, not occurrence 1, as the previous session when comparing from occurrence 3 of the same day', () => {
    const date = '2026-10-03';
    const occurrence1 = buildExecution({
      executionId: 'exec_wpi1_0_2026-10-03', programInstanceId: 'inst-1', sessionIndex: 0, occurrence: 1,
      scheduledLocalDate: date, exercises: [exercise('bench', 0, [completedSet(60, 10)])],
      startedAtMs: Date.parse('2026-10-03T08:00:00Z'), finishedAtMs: Date.parse('2026-10-03T08:45:00Z'),
    });
    const occurrence2 = buildExecution({
      executionId: 'exec_wpi1_0_2026-10-03_o2', programInstanceId: 'inst-1', sessionIndex: 0, occurrence: 2,
      scheduledLocalDate: date, exercises: [exercise('bench', 0, [completedSet(62.5, 10)])],
      startedAtMs: Date.parse('2026-10-03T18:00:00Z'), finishedAtMs: Date.parse('2026-10-03T18:45:00Z'),
    });
    const occurrence3 = buildExecution({
      executionId: 'exec_wpi1_0_2026-10-03_o3', programInstanceId: 'inst-1', sessionIndex: 0, occurrence: 3,
      scheduledLocalDate: date, exercises: [exercise('bench', 0, [completedSet(65, 10)])],
      startedAtMs: Date.parse('2026-10-04T08:00:00Z'), finishedAtMs: Date.parse('2026-10-04T08:45:00Z'),
    });
    // Deliberately NOT in chronological order — proves the result comes from
    // the real instant/occurrence, never from input array position.
    const executions = [occurrence3, occurrence1, occurrence2];

    const result = findPreviousEquivalentExecution(executions, {
      programId: 'program-1', programInstanceId: 'inst-1', sessionIndex: 0, excludeExecutionId: occurrence3.executionId,
    });

    expect(result?.executionId).toBe(occurrence2.executionId);
  });

  it('breaks a tied real instant by occurrence number (defensive — real timestamps should never actually tie)', () => {
    const date = '2026-10-03';
    const occurrence1 = buildExecution({
      executionId: 'exec_wpi1_0_2026-10-03', programInstanceId: 'inst-1', sessionIndex: 0, occurrence: 1,
      scheduledLocalDate: date, exercises: [],
      startedAtMs: Date.parse('2026-10-03T08:00:00Z'), finishedAtMs: Date.parse('2026-10-03T08:00:00Z'),
    });
    const occurrence2 = buildExecution({
      executionId: 'exec_wpi1_0_2026-10-03_o2', programInstanceId: 'inst-1', sessionIndex: 0, occurrence: 2,
      scheduledLocalDate: date, exercises: [],
      startedAtMs: Date.parse('2026-10-03T08:00:00Z'), finishedAtMs: Date.parse('2026-10-03T08:00:00Z'),
    });

    const result = findPreviousEquivalentExecution([occurrence1, occurrence2], {
      programId: 'program-1', programInstanceId: 'inst-1', sessionIndex: 0, excludeExecutionId: 'other',
    });

    expect(result?.executionId).toBe(occurrence2.executionId);
  });

  it('excludes the current execution and ABANDONED sessions, and returns null when nothing comparable exists (first-ever session)', () => {
    const executions = [
      buildExecution({ executionId: 'current', programInstanceId: 'inst-1', sessionIndex: 0, scheduledLocalDate: '2026-08-08', exercises: [] }),
      buildExecution({ executionId: 'abandoned', programInstanceId: 'inst-1', sessionIndex: 0, scheduledLocalDate: '2026-08-01', status: 'ABANDONED', exercises: [] }),
    ];

    const result = findPreviousEquivalentExecution(executions, {
      programId: 'program-1',
      programInstanceId: 'inst-1',
      sessionIndex: 0,
      excludeExecutionId: 'current',
    });

    expect(result).toBeNull();
  });
});
