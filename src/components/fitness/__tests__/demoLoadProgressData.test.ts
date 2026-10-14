import { describe, expect, it } from 'vitest';
import { buildDemoLoadExercises, buildDemoLoadRecords } from '../demoLoadProgressData';

describe('buildDemoLoadExercises', () => {
  it('returns real exercise ids with at least two ascending, chronologically-ordered points', () => {
    const exercises = buildDemoLoadExercises('2026-10-09');

    expect(exercises.length).toBeGreaterThan(0);
    exercises.forEach((exercise) => {
      expect(exercise.history.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i + 1 < exercise.history.length; i += 1) {
        expect(exercise.history[i]!.localDate < exercise.history[i + 1]!.localDate).toBe(true);
        expect(exercise.history[i]!.loadKg).toBeLessThanOrEqual(exercise.history[i + 1]!.loadKg);
      }
    });
  });

  it('never dates a point after the given "today"', () => {
    const exercises = buildDemoLoadExercises('2026-10-09');
    exercises.forEach((exercise) => {
      exercise.history.forEach((point) => {
        expect(point.localDate <= '2026-10-09').toBe(true);
      });
    });
  });
});

describe('buildDemoLoadRecords', () => {
  it('returns one record per demo exercise, each strictly beating its previous best', () => {
    const records = buildDemoLoadRecords('2026-10-09');
    expect(records.length).toBeGreaterThan(0);
    records.forEach((record) => {
      expect(record.loadKg).toBeGreaterThan(record.previousBestKg);
      expect(record.localDate <= '2026-10-09').toBe(true);
    });
  });
});
