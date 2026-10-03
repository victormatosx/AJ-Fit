import { describe, expect, it } from 'vitest';

import {
  CompletedSetEditError,
  adjustSetEditRepsText,
  adjustSetEditWeightText,
  applyCompletedSetEdit,
  beginCompletedSetEditFlight,
  parseSetEditDraft,
} from '../setEdit';
import type { ExerciseExecution } from '../types';

function exercises(): ExerciseExecution[] {
  return [{
    exerciseIndex: 0,
    exerciseId: 'bench',
    prescribedSets: 2,
    prescribedReps: '8-12',
    prescribedDuration: null,
    prescribedCycles: null,
    sets: [
      { setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 50, actualDurationSeconds: null },
      { setIndex: 1, status: 'COMPLETED', actualReps: null, weightKg: null, actualDurationSeconds: 30 },
    ],
  }, {
    exerciseIndex: 1,
    exerciseId: 'row',
    prescribedSets: 1,
    prescribedReps: '10',
    prescribedDuration: null,
    prescribedCycles: null,
    sets: [{ setIndex: 0, status: 'PENDING', actualReps: null, weightKg: null, actualDurationSeconds: null }],
  }];
}

describe('completed set edit domain', () => {
  it('edits reps only and preserves load, completion, duration, and every other set', () => {
    const before = exercises();
    const result = applyCompletedSetEdit(before, 0, 1, { actualReps: 8 });

    expect(result.set).toEqual({
      setIndex: 1,
      status: 'COMPLETED',
      actualReps: 8,
      weightKg: null,
      actualDurationSeconds: 30,
    });
    expect(result.exercises[0].sets[0]).toBe(before[0].sets[0]);
    expect(result.exercises[1]).toBe(before[1]);
  });

  it('edits load only, including a meaningful zero, without changing reps', () => {
    expect(applyCompletedSetEdit(exercises(), 0, 0, { weightKg: 0 }).set)
      .toMatchObject({ status: 'COMPLETED', actualReps: 10, weightKg: 0 });
  });

  it('edits both values in one set without touching another series', () => {
    const result = applyCompletedSetEdit(exercises(), 0, 0, { actualReps: 8, weightKg: 60 });
    expect(result.set).toMatchObject({ status: 'COMPLETED', actualReps: 8, weightKg: 60 });
    expect(result.exercises[0].sets[1]).toMatchObject({ actualReps: null, weightKg: null });
  });

  it('preserves null distinctly from zero', () => {
    expect(applyCompletedSetEdit(exercises(), 0, 0, { actualReps: null, weightKg: null }).set)
      .toMatchObject({ actualReps: null, weightKg: null });
    expect(applyCompletedSetEdit(exercises(), 0, 0, { weightKg: 0 }).set.weightKg).toBe(0);
  });

  it('refuses PENDING sets and invalid values', () => {
    expect(() => applyCompletedSetEdit(exercises(), 1, 0, { weightKg: 20 }))
      .toThrowError(new CompletedSetEditError('SET_NOT_COMPLETED'));
    expect(() => applyCompletedSetEdit(exercises(), 0, 0, { actualReps: 1.5 }))
      .toThrowError(new CompletedSetEditError('INVALID_ACTUAL_REPS'));
    expect(() => applyCompletedSetEdit(exercises(), 0, 0, { weightKg: -1 }))
      .toThrowError(new CompletedSetEditError('INVALID_WEIGHT_KG'));
  });
});

describe('completed set editor input', () => {
  it('parses direct input and keeps empty distinct from zero', () => {
    expect(parseSetEditDraft('8', '60', 'metric')).toEqual({ ok: true, actualReps: 8, weightKg: 60 });
    expect(parseSetEditDraft('', '', 'metric')).toEqual({ ok: true, actualReps: null, weightKg: null });
    expect(parseSetEditDraft('', '0', 'metric')).toEqual({ ok: true, actualReps: null, weightKg: 0 });
  });

  it('accepts a decimal comma and converts display pounds to canonical kg', () => {
    expect(parseSetEditDraft('10', '55,5', 'metric')).toEqual({ ok: true, actualReps: 10, weightKg: 55.5 });
    const imperial = parseSetEditDraft('10', '100', 'imperial');
    expect(imperial.ok && imperial.weightKg).toBeCloseTo(45.3592, 4);
  });

  it.each([
    ['0', '50', 'actualReps'],
    ['2.5', '50', 'actualReps'],
    ['8', '-1', 'weightKg'],
    ['8', '1.2.3', 'weightKg'],
  ])('rejects invalid values (%s, %s)', (reps, weight, field) => {
    expect(parseSetEditDraft(reps, weight, 'metric')).toEqual({ ok: false, field });
  });

  it('uses the existing +/− conventions (1 rep, 2.5 kg, 5 lb)', () => {
    expect(adjustSetEditRepsText('10', -1)).toBe('9');
    expect(adjustSetEditRepsText('', 1)).toBe('1');
    expect(adjustSetEditRepsText('1', -1)).toBe('');
    expect(adjustSetEditWeightText('55', 1, 'metric')).toBe('57.5');
    expect(adjustSetEditWeightText('2.5', -1, 'metric')).toBe('0');
    expect(adjustSetEditWeightText('100', 1, 'imperial')).toBe('105');
  });

  it('coalesces a double tap into one write and permits a later retry', async () => {
    const flights = new Map<string, Promise<{ ok: boolean }>>();
    let resolve!: (value: { ok: boolean }) => void;
    let writes = 0;
    const operation = () => {
      writes += 1;
      return new Promise<{ ok: boolean }>((done) => { resolve = done; });
    };

    const first = beginCompletedSetEditFlight(flights, 'set:0:0', operation);
    const doubleTap = beginCompletedSetEditFlight(flights, 'set:0:0', operation);
    expect(doubleTap).toBe(first);
    expect(writes).toBe(1);
    resolve({ ok: true });
    await first;
    await Promise.resolve();

    const retry = beginCompletedSetEditFlight(flights, 'set:0:0', async () => {
      writes += 1;
      return { ok: true };
    });
    await retry;
    expect(writes).toBe(2);
  });
});
