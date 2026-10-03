import { describe, expect, it } from 'vitest';

import type { LoadPersonalRecord } from '../../loadProgress/loadProgress';
import { selectWorkoutHighlights } from '../highlights';
import { buildExecution, completedSet, exercise } from './testFixtures';

function pr(executionId: string, exerciseId: string, loadKg: number, previousBestKg: number): LoadPersonalRecord {
  return { executionId, exerciseId, localDate: '2026-09-08', loadKg, previousBestKg };
}

describe('selectWorkoutHighlights', () => {
  it('ranks PR exercises first, in session order', () => {
    const execution = buildExecution({
      executionId: 'current',
      scheduledLocalDate: '2026-09-08',
      exercises: [
        exercise('squat', 1, [completedSet(100, 5)]),
        exercise('bench', 0, [completedSet(65, 10)]),
      ],
    });
    const highlights = selectWorkoutHighlights({
      execution,
      recordsLast90Days: [pr('current', 'bench', 65, 60), pr('current', 'squat', 100, 90)],
      previousEquivalentExecution: null,
    });
    expect(highlights.map((item) => item.exerciseId)).toEqual(['bench', 'squat']);
    expect(highlights.every((item) => item.isPersonalRecord)).toBe(true);
  });

  it('after PRs, ranks by largest improvement over the previous equivalent session', () => {
    const execution = buildExecution({
      executionId: 'current',
      scheduledLocalDate: '2026-09-08',
      exercises: [
        exercise('bench', 0, [completedSet(62.5, 10)]),
        exercise('squat', 1, [completedSet(105, 5)]),
        exercise('row', 2, [completedSet(42.5, 10)]),
      ],
    });
    const previous = buildExecution({
      executionId: 'previous',
      scheduledLocalDate: '2026-09-01',
      exercises: [
        exercise('bench', 0, [completedSet(60, 10)]),
        exercise('squat', 1, [completedSet(100, 5)]),
        exercise('row', 2, [completedSet(42.5, 10)]),
      ],
    });

    const highlights = selectWorkoutHighlights({
      execution,
      recordsLast90Days: [],
      previousEquivalentExecution: previous,
      maxItems: 2,
    });

    // squat improved by 5kg, bench by 2.5kg, row by 0 -> squat first, then bench.
    expect(highlights.map((item) => item.exerciseId)).toEqual(['squat', 'bench']);
  });

  it('falls back to best load of the session when there is no PR and no previous session to compare against', () => {
    const execution = buildExecution({
      executionId: 'current',
      scheduledLocalDate: '2026-09-08',
      exercises: [
        exercise('bench', 0, [completedSet(60, 10)]),
        exercise('squat', 1, [completedSet(100, 5)]),
      ],
    });

    const highlights = selectWorkoutHighlights({
      execution,
      recordsLast90Days: [],
      previousEquivalentExecution: null,
      maxItems: 1,
    });

    expect(highlights).toEqual([
      expect.objectContaining({ exerciseId: 'squat', maxLoadKg: 100, isPersonalRecord: false }),
    ]);
  });

  it('never fabricates a highlight for a bodyweight/duration-only exercise with no PR and no valid load', () => {
    const execution = buildExecution({
      executionId: 'current',
      scheduledLocalDate: '2026-09-08',
      exercises: [exercise('pullup', 0, [completedSet(0, 10)])],
    });

    const highlights = selectWorkoutHighlights({ execution, recordsLast90Days: [], previousEquivalentExecution: null });
    expect(highlights).toEqual([]);
  });

  it('never picks the same exercise twice across the three tiers', () => {
    const execution = buildExecution({
      executionId: 'current',
      scheduledLocalDate: '2026-09-08',
      exercises: [exercise('bench', 0, [completedSet(65, 10)])],
    });
    const previous = buildExecution({
      executionId: 'previous',
      scheduledLocalDate: '2026-09-01',
      exercises: [exercise('bench', 0, [completedSet(60, 10)])],
    });

    const highlights = selectWorkoutHighlights({
      execution,
      recordsLast90Days: [pr('current', 'bench', 65, 60)],
      previousEquivalentExecution: previous,
    });

    expect(highlights).toHaveLength(1);
    expect(highlights[0].exerciseId).toBe('bench');
  });
});
