import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  },
}));

import {
  WORKOUT_SUBSTITUTIONS_STORAGE_KEY,
  clearWorkoutSubstitutionPreferences,
} from '../workoutSubstitutionsStorage';

beforeEach(() => {
  storage.clear();
});

describe('clearWorkoutSubstitutionPreferences', () => {
  it('removes the substitutions key', async () => {
    storage.set(WORKOUT_SUBSTITUTIONS_STORAGE_KEY, JSON.stringify({ ex1: { name: 'sub' } }));

    await clearWorkoutSubstitutionPreferences();

    expect(storage.has(WORKOUT_SUBSTITUTIONS_STORAGE_KEY)).toBe(false);
  });

  it('is a no-op, never throws, when nothing is stored', async () => {
    await expect(clearWorkoutSubstitutionPreferences()).resolves.toBeUndefined();
  });
});
