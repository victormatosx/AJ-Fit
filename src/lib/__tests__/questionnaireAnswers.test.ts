import { Timestamp } from 'firebase/firestore';
import { describe,expect,it } from 'vitest';
import { defaultQuiz,type Quiz } from '../../state/AppState';
import { computeAge } from '../ageCalculator';
import { fromPersistedAnswers,toPersistedAnswers } from '../questionnaireAnswers';

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

  it('persists health as its own goal value and restores it unchanged', () => {
    const persisted = toPersistedAnswers({ ...fullQuiz, goal: 'health' });
    expect(persisted.goal).toBe('health');
    expect(fromPersistedAnswers(persisted, Timestamp.now()).goal).toBe('health');
  });

  it('round-trips canonical selector and modifier fields', () => {
    const canonical: Quiz = {
      ...fullQuiz,
      goal: 'body_composition',
      level: 'intermediate',
      place: 'home',
      equipment: ['dumbbells', 'bands'],
      specialConditions: ['pregnancy'],
      pregnancyScreening: {
        weeks: 18,
        prenatalCare: 'yes',
        exerciseRestriction: 'no',
        complication: 'unsure',
        warningSigns: ['none'],
      },
    };
    expect(fromPersistedAnswers(toPersistedAnswers(canonical), Timestamp.now())).toMatchObject({
      goal: 'body_composition',
      level: 'intermediate',
      place: 'home',
      equipment: ['dumbbells', 'bands'],
      specialConditions: ['pregnancy'],
      pregnancyScreening: canonical.pregnancyScreening,
    });
  });

  it('never persists physical-limitation answers to Firestore — purely informational, local-state-only (see src/workoutPrescription/input.ts sanitizeAnswersForEngine for the matching read-side strip)', () => {
    const withLimitation: Quiz = {
      ...fullQuiz,
      limits: ['knee', 'back'],
      specialConditions: ['musculoskeletal_limitation'],
    };
    const persisted = toPersistedAnswers(withLimitation);
    expect(Object.prototype.hasOwnProperty.call(persisted, 'limits')).toBe(false);
    expect(JSON.stringify(persisted)).not.toMatch(/limits|musculoskeletal/);
    expect(persisted.specialConditions).not.toContain('musculoskeletal_limitation');

    const restored = fromPersistedAnswers(persisted, Timestamp.now());
    expect(restored.limits).toEqual([]);
    expect(restored.specialConditions).not.toContain('musculoskeletal_limitation');
  });

  it('never resurrects a legacy Firestore document that happens to still carry limits/musculoskeletal_limitation', () => {
    const legacyRaw = {
      ...toPersistedAnswers(fullQuiz),
      limits: ['shoulder'],
      specialConditions: ['musculoskeletal_limitation'],
    };
    const restored = fromPersistedAnswers(legacyRaw as any, Timestamp.now());
    expect(restored.limits).toEqual([]);
    expect(restored.specialConditions).not.toContain('musculoskeletal_limitation');
  });

  it('folds legacy both + primaryPlace into the canonical place and never writes primaryPlace again', () => {
    const restored = fromPersistedAnswers({
      ...toPersistedAnswers(fullQuiz),
      place: 'both',
      primaryPlace: 'home',
    }, Timestamp.now());
    expect(restored.place).toBe('home');
    expect(Object.prototype.hasOwnProperty.call(restored, 'primaryPlace')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(toPersistedAnswers(restored), 'primaryPlace')).toBe(false);
  });

  it('reads and ignores removed legacy fields, and never writes them again', () => {
    const legacy = {
      ...toPersistedAnswers(fullQuiz),
      limitationImpact: 'professional_restriction',
      motivation: 'strength',
      primaryPlace: 'gym',
    };
    const restored = fromPersistedAnswers(legacy, Timestamp.now());
    expect(Object.prototype.hasOwnProperty.call(restored, 'limitationImpact')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(restored, 'motivation')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(restored, 'primaryPlace')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(toPersistedAnswers(restored), 'limitationImpact')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(toPersistedAnswers(restored), 'motivation')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(toPersistedAnswers(restored), 'primaryPlace')).toBe(false);
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

  it('preserves the removed elite UI value as a readable legacy value', () => {
    const restored = fromPersistedAnswers({ ...toPersistedAnswers(fullQuiz), level: 'elite' }, Timestamp.now());
    expect(restored.level).toBe('elite');
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
