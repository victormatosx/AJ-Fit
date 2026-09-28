import { describe, expect, it } from 'vitest';
import {
  buildSeedDocuments,
  contentHash,
  validateCanonicalSnapshot,
  WORKOUT_TEMPLATES_COLLECTION,
} from '../../../scripts/seedWorkoutTemplates';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { WORKOUT_TEMPLATES } from '../catalog';

describe('workout template seed source', () => {
  it('contains exactly T001-T090, 378 sessions, 2,116 valid slots', () => {
    const documents = buildSeedDocuments();
    expect(documents).toHaveLength(90);
    expect(documents.flatMap((item) => item.sessions)).toHaveLength(378);
    expect(documents.flatMap((item) => item.sessions).flatMap((item) => item.exercises)).toHaveLength(2116);
    expect(documents.map((item) => item.id)).toEqual(
      Array.from({ length: 90 }, (_, index) => `T${String(index + 1).padStart(3, '0')}`),
    );
    expect(validateCanonicalSnapshot(new Set(EXERCISES_SEED.map((item) => item.id)))).toEqual([]);
  });

  it('validates seed input structurally without a global template total', () => {
    const current = buildSeedDocuments();
    expect(current).toHaveLength(90);
    expect(validateCanonicalSnapshot()).toEqual([]);
    const future = {
      schema_version: '1.27.0', library: 'future-test',
      workouts: [{ ...WORKOUT_TEMPLATES[0], id: 'T091' as const }],
    };
    expect(validateCanonicalSnapshot(undefined, future)).toEqual([]);
    expect(buildSeedDocuments(future)).toHaveLength(1);
  });

  it('uses a stable content hash and normalized string exercise ids', () => {
    const [first] = buildSeedDocuments();
    const { contentHash: expectedHash, ...body } = first;
    expect(contentHash(body)).toBe(expectedHash);
    expect(buildSeedDocuments()[0].contentHash).toBe(first.contentHash);
    expect(first.sessions.every((session) => session.exercises.every((slot) => typeof slot.exerciseId === 'string'))).toBe(true);
    expect(JSON.stringify(first)).not.toContain('exercise_id');
  });

  it('uses one collection and has no delete seed action', () => {
    expect(WORKOUT_TEMPLATES_COLLECTION).toBe('workoutTemplates');
    expect(['CREATE', 'UPDATE', 'UNCHANGED', 'BLOCKED', 'ERROR']).not.toContain('DELETE');
  });
});
