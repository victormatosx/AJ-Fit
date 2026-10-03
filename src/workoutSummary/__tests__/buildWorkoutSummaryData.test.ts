import { describe, expect, it } from 'vitest';

import type { LoadPersonalRecord } from '../../loadProgress/loadProgress';
import { buildWorkoutSummaryData } from '../buildWorkoutSummaryData';
import { buildExecution, completedSet, exercise, skippedSet } from './testFixtures';

function pr(executionId: string, exerciseId: string, loadKg: number, previousBestKg: number): LoadPersonalRecord {
  return { executionId, exerciseId, localDate: '2026-09-08', loadKg, previousBestKg };
}

describe('buildWorkoutSummaryData', () => {
  it('reports no personal records and a neutral "current bests" fallback when nothing was a PR today', () => {
    const execution = buildExecution({
      executionId: 'current',
      scheduledLocalDate: '2026-09-08',
      exercises: [exercise('bench', 0, [completedSet(60, 10)])],
    });

    const data = buildWorkoutSummaryData({
      workoutName: 'Push',
      execution,
      durationSeconds: 3600,
      recordsLast90Days: [],
      previousEquivalentExecution: null,
    });

    expect(data.personalRecordCount).toBe(0);
    expect(data.personalRecords).toEqual([]);
    expect(data.currentBests).toEqual([{ exerciseId: 'bench', loadKg: 60 }]);
    expect(data.hasLoadBasedData).toBe(true);
    expect(data.pulse).toEqual({ hasPreviousSession: false, metrics: null });
  });

  it('reports personal records set in this exact execution only, excluding other sessions\' records', () => {
    const execution = buildExecution({
      executionId: 'current',
      scheduledLocalDate: '2026-09-08',
      exercises: [exercise('bench', 0, [completedSet(65, 10)])],
    });

    const data = buildWorkoutSummaryData({
      workoutName: 'Push',
      execution,
      durationSeconds: 3600,
      recordsLast90Days: [pr('current', 'bench', 65, 60), pr('some-other-day', 'squat', 100, 90)],
      previousEquivalentExecution: null,
    });

    expect(data.personalRecordCount).toBe(1);
    expect(data.personalRecords).toEqual([{ exerciseId: 'bench', newLoadKg: 65, previousBestKg: 60 }]);
    expect(data.currentBests).toEqual([]);
  });

  it('flags hasLoadBasedData false for an entirely bodyweight/duration session, never faking a load number', () => {
    const execution = buildExecution({
      executionId: 'current',
      scheduledLocalDate: '2026-09-08',
      exercises: [exercise('plank', 0, [{ setIndex: 0, status: 'COMPLETED', actualReps: null, weightKg: null, actualDurationSeconds: 60 }])],
    });

    const data = buildWorkoutSummaryData({
      workoutName: 'Core',
      execution,
      durationSeconds: 600,
      recordsLast90Days: [],
      previousEquivalentExecution: null,
    });

    expect(data.hasLoadBasedData).toBe(false);
    expect(data.volumeKg).toBe(0);
  });

  it('derives the muscles-worked body map strictly from exercises with a COMPLETED set', () => {
    const execution = buildExecution({
      executionId: 'current',
      scheduledLocalDate: '2026-09-08',
      exercises: [exercise('bench-press-barbell', 0, [completedSet(60, 10)])],
    });

    const data = buildWorkoutSummaryData({
      workoutName: 'Push',
      execution,
      durationSeconds: 600,
      recordsLast90Days: [],
      previousEquivalentExecution: null,
    });

    // Unknown catalog id resolves to an empty breakdown rather than throwing.
    expect(data.bodyMap).toEqual({ primary: [], secondary: [] });
  });

  it('clamps a negative/garbage duration to a non-negative integer, never surfacing a negative time', () => {
    const execution = buildExecution({ executionId: 'current', scheduledLocalDate: '2026-09-08', exercises: [] });
    const data = buildWorkoutSummaryData({
      workoutName: 'Push',
      execution,
      durationSeconds: -5.7,
      recordsLast90Days: [],
      previousEquivalentExecution: null,
    });
    expect(data.durationSeconds).toBe(0);
  });

  it('uses server-authoritative completion and exposes early/cardio-skipped presentation facts', () => {
    const execution = buildExecution({
      executionId: 'partial',
      scheduledLocalDate: '2026-09-08',
      status: 'PARTIALLY_COMPLETED',
      finalizationMode: 'EARLY',
      exercises: [exercise('bench', 0, [completedSet(60, 10), {
        setIndex: 1, status: 'SKIPPED', actualReps: null, weightKg: null, actualDurationSeconds: null,
      }])],
      completion: { plannedSets: 2, completedSets: 1, percentageBasisPoints: 5000 },
      cardio: { status: 'SKIPPED', reason: 'EARLY_FINISH', skippedAt: {} },
    });
    const data = buildWorkoutSummaryData({
      workoutName: 'Push', execution, durationSeconds: 600, recordsLast90Days: [], previousEquivalentExecution: null,
    });
    expect(data.completion).toEqual({ plannedSets: 2, completedSets: 1, percentageBasisPoints: 5000 });
    expect(data.finalizedEarly).toBe(true);
    expect(data.cardioSkipped).toBe(true);
    expect(data.completedSetCount).toBe(1);
  });

  // 2026-10 fix: `PARTIALLY_COMPLETED` is NOT exclusive to an early finish —
  // a plain NORMAL finish lands there too whenever sets were skipped along
  // the way. The badge must key off the persisted intent, never the status.
  it('never shows the early-finish badge for a NORMAL finish that happens to end PARTIALLY_COMPLETED', () => {
    const execution = buildExecution({
      executionId: 'normal-partial',
      scheduledLocalDate: '2026-09-08',
      status: 'PARTIALLY_COMPLETED',
      finalizationMode: 'NORMAL',
      exercises: [exercise('bench', 0, [completedSet(60, 10), {
        setIndex: 1, status: 'SKIPPED', actualReps: null, weightKg: null, actualDurationSeconds: null,
      }])],
      completion: { plannedSets: 2, completedSets: 1, percentageBasisPoints: 5000 },
    });
    const data = buildWorkoutSummaryData({
      workoutName: 'Push', execution, durationSeconds: 600, recordsLast90Days: [], previousEquivalentExecution: null,
    });
    expect(data.finalizedEarly).toBe(false);
  });

  it('derives a safe legacy fallback, but never assumes 100% for malformed history — and never infers EARLY from an absent finalizationMode', () => {
    const legacy = buildExecution({
      executionId: 'legacy',
      scheduledLocalDate: '2026-09-08',
      status: 'PARTIALLY_COMPLETED',
      exercises: [exercise('bench', 0, [completedSet(60, 10), {
        setIndex: 1, status: 'SKIPPED', actualReps: null, weightKg: null, actualDurationSeconds: null,
      }])],
    });
    const legacyData = buildWorkoutSummaryData({
      workoutName: 'Push', execution: legacy, durationSeconds: 600, recordsLast90Days: [], previousEquivalentExecution: null,
    });
    expect(legacyData.completion).toEqual({ plannedSets: 2, completedSets: 1, percentageBasisPoints: 5000 });
    expect(legacyData.finalizedEarly).toBe(false);

    const malformed = buildExecution({
      executionId: 'malformed', scheduledLocalDate: '2026-09-08', status: 'COMPLETED', exercises: [],
    });
    const malformedData = buildWorkoutSummaryData({
      workoutName: 'Push', execution: malformed, durationSeconds: 600, recordsLast90Days: [], previousEquivalentExecution: null,
    });
    expect(malformedData.completion).toBeNull();
  });

  // Audit test gap: no test previously exercised the fallback path
  // (`resolveWorkoutCompletion`'s legacy branch, no persisted `completion`)
  // for a session mixing COMPLETED and SKIPPED sets — confirms SKIPPED never
  // enters the numerator there either, not just in the server's authoritative
  // `prescribedExecutionCounts` path.
  it('resolveWorkoutCompletion fallback never counts SKIPPED in the numerator for legacy history with no persisted completion', () => {
    const execution = buildExecution({
      executionId: 'legacy-mixed',
      scheduledLocalDate: '2026-09-08',
      status: 'PARTIALLY_COMPLETED',
      exercises: [
        exercise('bench', 0, [completedSet(60, 10), skippedSet(), completedSet(60, 8)]),
        exercise('row', 1, [skippedSet(), skippedSet()]),
      ],
    });
    const data = buildWorkoutSummaryData({
      workoutName: 'Push', execution, durationSeconds: 600, recordsLast90Days: [], previousEquivalentExecution: null,
    });
    // 2 COMPLETED out of 5 total sets — SKIPPED (3 of them) never credited.
    expect(data.completion).toEqual({ plannedSets: 5, completedSets: 2, percentageBasisPoints: 4000 });
  });
});
