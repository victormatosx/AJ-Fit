import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { defaultQuiz, type Quiz } from '../../state/AppState';
import { computeAge } from '../ageCalculator';
import { fromPersistedAnswers, toPersistedAnswers } from '../questionnaireAnswers';

const fullQuiz: Quiz = {
  ...defaultQuiz,
  sex: 'f',
  birthDate: new Date(1995, 5, 10),
  height: 165,
  weight: 60,
  goal: 'cut',
  frequency: '4x',
  level: 'int',
  limits: ['knee'],
  duration: '45',
  days: 4,
  place: 'gym',
  equipment: ['dumbbell'],
  style: ['hiit'],
};

describe('toPersistedAnswers / fromPersistedAnswers (new shape)', () => {
  it('round-trips birthDate through a Firestore Timestamp', () => {
    const persisted = toPersistedAnswers(fullQuiz);
    expect(persisted.birthDate).toBeInstanceOf(Timestamp);
    expect(persisted.age).toBeUndefined();

    const restored = fromPersistedAnswers(persisted, Timestamp.now());
    expect(restored.birthDate?.getTime()).toBe(fullQuiz.birthDate!.getTime());
    expect(restored).toMatchObject({ sex: 'f', height: 165, weight: 60, goal: 'cut' });
  });

  it('persists a null birthDate as null, not a fabricated date', () => {
    const persisted = toPersistedAnswers({ ...fullQuiz, birthDate: null });
    expect(persisted.birthDate).toBeNull();
    expect(fromPersistedAnswers(persisted, Timestamp.now()).birthDate).toBeNull();
  });
});

describe('fromPersistedAnswers — legacy `age`-only documents (backward compat)', () => {
  it('derives birthDate from age, anchored to the questionnaire createdAt', () => {
    const createdAt = Timestamp.fromDate(new Date(2020, 0, 10));
    const restored = fromPersistedAnswers({ ...fullQuiz, birthDate: undefined, age: 28 } as any, createdAt);

    expect(restored.birthDate).not.toBeNull();
    // Age at the doc's own createdAt must equal the legacy value exactly...
    expect(computeAge(restored.birthDate!, createdAt.toDate())).toBe(28);
    // ...and must have advanced by the time this test runs (not frozen at 28).
    expect(computeAge(restored.birthDate!)).toBeGreaterThan(28);
  });

  it('prefers birthDate over legacy age when both are somehow present', () => {
    const createdAt = Timestamp.now();
    const explicitBirthDate = Timestamp.fromDate(new Date(1990, 0, 1));
    const restored = fromPersistedAnswers(
      { ...fullQuiz, birthDate: explicitBirthDate, age: 99 } as any,
      createdAt,
    );
    expect(restored.birthDate?.getTime()).toBe(explicitBirthDate.toDate().getTime());
  });
});

describe('fromPersistedAnswers — corrupted/sparse documents never throw', () => {
  it('handles a completely missing answers map', () => {
    expect(() => fromPersistedAnswers(undefined, null)).not.toThrow();
    const restored = fromPersistedAnswers(undefined, null);
    expect(restored.birthDate).toBeNull();
    // Backfilled from defaultQuiz — array fields are real arrays, not undefined.
    expect(Array.isArray(restored.limits)).toBe(true);
    expect(Array.isArray(restored.equipment)).toBe(true);
    expect(() => restored.limits.includes('knee')).not.toThrow();
  });

  it('handles a sparse answers map missing most fields', () => {
    const restored = fromPersistedAnswers({ sex: 'm' } as any, null);
    expect(restored.sex).toBe('m');
    expect(restored.birthDate).toBeNull();
    expect(restored.height).toBe(defaultQuiz.height);
    expect(Array.isArray(restored.style)).toBe(true);
  });
});
