import { describe, expect, it } from 'vitest';

import {
  deriveLoadProgress,
  loadHistoryForPeriod,
  normalizeExerciseSearch,
  type LoadProgressExecution,
} from '../loadProgress';

function execution(
  executionId: string,
  scheduledLocalDate: string,
  exerciseId: string,
  weights: (number | null)[],
  status: LoadProgressExecution['status'] = 'COMPLETED',
): LoadProgressExecution {
  return {
    executionId,
    scheduledLocalDate,
    status,
    exercises: [{
      exerciseId,
      sets: weights.map((weightKg) => ({ status: 'COMPLETED', weightKg })),
    }],
  };
}

describe('deriveLoadProgress', () => {
  it('uses the real maximum completed load per execution and counts strict PRs in the last 90 days', () => {
    const result = deriveLoadProgress([
      execution('baseline', '2026-05-01', 'bench', [50, 55, 55]),
      execution('old-pr', '2026-05-10', 'bench', [60]),
      execution('recent-equal', '2026-07-01', 'bench', [60]),
      execution('recent-pr', '2026-07-15', 'bench', [62.5, 65]),
      execution('current-pr', '2026-08-01', 'bench', [67.5], 'IN_PROGRESS'),
    ], '2026-08-01');

    expect(result.exercises).toEqual([{
      exerciseId: 'bench',
      history: [
        { executionId: 'baseline', localDate: '2026-05-01', loadKg: 55 },
        { executionId: 'old-pr', localDate: '2026-05-10', loadKg: 60 },
        { executionId: 'recent-equal', localDate: '2026-07-01', loadKg: 60 },
        { executionId: 'recent-pr', localDate: '2026-07-15', loadKg: 65 },
        { executionId: 'current-pr', localDate: '2026-08-01', loadKg: 67.5 },
      ],
    }]);
    expect(result.recordsLast90Days.map((record) => ({
      id: record.executionId,
      load: record.loadKg,
      previous: record.previousBestKg,
    }))).toEqual([
      { id: 'current-pr', load: 67.5, previous: 65 },
      { id: 'recent-pr', load: 65, previous: 60 },
      { id: 'old-pr', load: 60, previous: 55 },
    ]);
  });

  it('ignores abandoned workouts, pending sets, nulls and bodyweight zero', () => {
    const pending: LoadProgressExecution = execution('mixed', '2026-08-01', 'row', [0, null, 30]);
    pending.exercises[0]!.sets[2]!.status = 'PENDING';

    const result = deriveLoadProgress([
      execution('abandoned', '2026-07-20', 'row', [100], 'ABANDONED'),
      pending,
    ], '2026-08-01');

    expect(result.exercises).toEqual([]);
    expect(result.recordsLast90Days).toEqual([]);
  });

  it('filters civil calendar windows inclusively', () => {
    const history = deriveLoadProgress([
      execution('a', '2026-06-02', 'squat', [80]),
      execution('b', '2026-06-03', 'squat', [85]),
      execution('c', '2026-07-02', 'squat', [90]),
    ], '2026-07-02').exercises[0]!.history;

    expect(loadHistoryForPeriod(history, 30, '2026-07-02').map((point) => point.executionId)).toEqual(['b', 'c']);
  });

  it('uses performedLocalDate for visual history and falls back for legacy executions', () => {
    const advanced = execution('advanced', '2026-09-18', 'squat', [90]);
    advanced.performedLocalDate = '2026-09-17';
    const legacy = execution('legacy', '2026-09-16', 'squat', [80]);
    const history = deriveLoadProgress([advanced, legacy], '2026-09-18').exercises[0]!.history;

    expect(history.map((point) => [point.executionId, point.localDate])).toEqual([
      ['legacy', '2026-09-16'],
      ['advanced', '2026-09-17'],
    ]);
  });
});

describe('normalizeExerciseSearch', () => {
  it('matches accents and casing consistently', () => {
    expect(normalizeExerciseSearch('  ELEVAÇÃO Lateral ')).toBe('elevacao lateral');
  });
});
