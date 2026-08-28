import { describe, expect, it } from 'vitest';
import {
  buildSeedDocuments,
  contentHash,
  EXPECTED_SESSION_COUNT,
  EXPECTED_SLOT_COUNT,
  EXPECTED_TEMPLATE_COUNT,
  validateCanonicalSnapshot,
  WORKOUT_TEMPLATES_COLLECTION,
} from '../../../scripts/seedWorkoutTemplates';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';

describe('workout template seed source', () => {
  it('contains exactly T001-T090, 378 sessions, 2,116 valid slots', () => {
    const documents = buildSeedDocuments();
    expect(documents).toHaveLength(EXPECTED_TEMPLATE_COUNT);
    expect(documents.flatMap((item) => item.sessions)).toHaveLength(EXPECTED_SESSION_COUNT);
    expect(documents.flatMap((item) => item.sessions).flatMap((item) => item.exercises)).toHaveLength(EXPECTED_SLOT_COUNT);
    expect(documents.map((item) => item.id)).toEqual(
      Array.from({ length: 90 }, (_, index) => `T${String(index + 1).padStart(3, '0')}`),
    );
    expect(validateCanonicalSnapshot(new Set(EXERCISES_SEED.map((item) => item.id)))).toEqual([]);
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
