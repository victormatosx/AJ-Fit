import { describe, expect, it } from 'vitest';
import {
  isValidProgressionSession,
  isValidProgressionSessionAgainstPrescription,
} from '../sessionQualification';

function execution(status: 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'ABANDONED', setStatuses: Array<'PENDING' | 'COMPLETED' | 'SKIPPED'>) {
  return {
    status,
    exercises: [{ sets: setStatuses.map((s) => ({ status: s })) }],
  };
}

describe('isValidProgressionSession', () => {
  it('COMPLETED is not proof by itself', () => {
    expect(isValidProgressionSession(execution('COMPLETED', []))).toBe(false);
    expect(isValidProgressionSession(execution('COMPLETED', ['SKIPPED']))).toBe(false);
    expect(isValidProgressionSession(execution('COMPLETED', ['COMPLETED']))).toBe(true);
  });

  it('IN_PROGRESS never counts', () => {
    expect(isValidProgressionSession(execution('IN_PROGRESS', Array(10).fill('COMPLETED')))).toBe(false);
  });

  it('ABANDONED never counts', () => {
    expect(isValidProgressionSession(execution('ABANDONED', Array(10).fill('COMPLETED')))).toBe(false);
  });

  it('a PARTIALLY_COMPLETED session with 0 prescribed sets never counts', () => {
    expect(isValidProgressionSession(execution('PARTIALLY_COMPLETED', []))).toBe(false);
  });

  const matrix: Array<{ completed: number; total: number; valid: boolean }> = [
    { completed: 0, total: 10, valid: false },
    { completed: 1, total: 10, valid: false }, // 10%
    { completed: 6, total: 10, valid: false }, // 60% < 70%
    { completed: 69, total: 100, valid: false }, // 69%
    { completed: 7, total: 10, valid: true }, // exactly 70%
    { completed: 70, total: 100, valid: true }, // exactly 70%
    { completed: 71, total: 100, valid: true }, // 71%
    { completed: 10, total: 10, valid: true }, // 100%
  ];

  it.each(matrix)('PARTIALLY_COMPLETED $completed/$total sets -> valid=$valid', ({ completed, total, valid }) => {
    const sets: Array<'COMPLETED' | 'SKIPPED'> = [
      ...Array(completed).fill('COMPLETED' as const),
      ...Array(total - completed).fill('SKIPPED' as const),
    ];
    expect(isValidProgressionSession(execution('PARTIALLY_COMPLETED', sets))).toBe(valid);
  });

  it('spans multiple exercises with different set counts', () => {
    const exec = {
      status: 'PARTIALLY_COMPLETED' as const,
      exercises: [
        { sets: [{ status: 'COMPLETED' as const }, { status: 'COMPLETED' as const }, { status: 'COMPLETED' as const }] },
        { sets: [{ status: 'SKIPPED' as const }] },
      ],
    };
    // 3/4 = 75% -> valid
    expect(isValidProgressionSession(exec)).toBe(true);
  });
});

describe('isValidProgressionSessionAgainstPrescription', () => {
  const prescribedSession = {
    exercises: [
      { exerciseId: 'a', setCount: 3 },
      { exerciseId: 'b', setCount: 3 },
      { exerciseId: 'c', setCount: 4 },
    ],
  };
  const set = (setIndex: number, status: 'COMPLETED' | 'SKIPPED') => ({ setIndex, status });
  const exerciseRecord = (exerciseIndex: number, exerciseId: string, completed: number, total: number) => ({
    exerciseIndex,
    exerciseId,
    sets: Array.from({ length: total }, (_, index) => set(index, index < completed ? 'COMPLETED' : 'SKIPPED')),
  });
  const authoritative = (exercises: ReturnType<typeof exerciseRecord>[], overrides: Record<string, unknown> = {}) => ({
    programInstanceId: 'wpi-a', sessionIndex: 0, status: 'PARTIALLY_COMPLETED' as const, exercises, ...overrides,
  });
  const qualify = (value: ReturnType<typeof authoritative>) => isValidProgressionSessionAgainstPrescription({
    execution: value,
    prescribedSession,
    expectedProgramInstanceId: 'wpi-a',
    expectedSessionIndex: 0,
  });

  it('uses the authoritative 10-set denominator at the exact boundary', () => {
    expect(qualify(authoritative([
      exerciseRecord(0, 'a', 3, 3), exerciseRecord(1, 'b', 3, 3), exerciseRecord(2, 'c', 1, 4),
    ]))).toBe(true);
    expect(qualify(authoritative([
      exerciseRecord(0, 'a', 3, 3), exerciseRecord(1, 'b', 3, 3), exerciseRecord(2, 'c', 0, 4),
    ]))).toBe(false);
  });

  it.each([
    ['omitted exercise', authoritative([exerciseRecord(0, 'a', 3, 3)])],
    ['empty completed', authoritative([], { status: 'COMPLETED' })],
    ['unknown exercise', authoritative([exerciseRecord(0, 'x', 3, 3), exerciseRecord(1, 'b', 3, 3), exerciseRecord(2, 'c', 4, 4)])],
    ['extra exercise', authoritative([exerciseRecord(0, 'a', 3, 3), exerciseRecord(1, 'b', 3, 3), exerciseRecord(2, 'c', 4, 4), exerciseRecord(3, 'd', 1, 1)])],
    ['duplicate exercise', authoritative([exerciseRecord(0, 'a', 3, 3), exerciseRecord(0, 'a', 3, 3), exerciseRecord(2, 'c', 4, 4)])],
    ['wrong session', authoritative([exerciseRecord(0, 'a', 3, 3), exerciseRecord(1, 'b', 3, 3), exerciseRecord(2, 'c', 4, 4)], { sessionIndex: 1 })],
    ['wrong instance', authoritative([exerciseRecord(0, 'a', 3, 3), exerciseRecord(1, 'b', 3, 3), exerciseRecord(2, 'c', 4, 4)], { programInstanceId: 'wpi-other' })],
  ])('rejects %s', (_label, value) => {
    expect(qualify(value as ReturnType<typeof authoritative>)).toBe(false);
  });

  it('rejects duplicate sets', () => {
    const value = authoritative([
      { ...exerciseRecord(0, 'a', 3, 3), sets: [set(0, 'COMPLETED'), set(0, 'COMPLETED'), set(2, 'COMPLETED')] },
      exerciseRecord(1, 'b', 3, 3), exerciseRecord(2, 'c', 4, 4),
    ]);
    expect(qualify(value)).toBe(false);
  });
});
