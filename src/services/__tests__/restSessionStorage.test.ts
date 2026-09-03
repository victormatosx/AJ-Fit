import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { createRest } from '../../lib/restTimer';
import {
  REST_SESSION_STORAGE_KEY,
  clearRestSession,
  persistRestSession,
  readRestSession,
} from '../restSessionStorage';

const REST = createRest({
  restId: 'rest-storage',
  workoutSessionId: 'session-storage',
  startedAt: 100_000,
  durationSeconds: 90,
  exerciseId: 'supino-reto',
  setIndex: 0,
  totalSets: 4,
});

beforeEach(() => {
  vi.clearAllMocks();
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockResolvedValue(undefined);
  storage.removeItem.mockResolvedValue(undefined);
});

describe('restSessionStorage', () => {
  it('persists the complete absolute rest only on an explicit transition', async () => {
    await persistRestSession(REST);
    expect(storage.setItem).toHaveBeenCalledWith(
      REST_SESSION_STORAGE_KEY,
      JSON.stringify(REST),
    );
  });

  it('reads a valid persisted rest', async () => {
    storage.getItem.mockResolvedValueOnce(JSON.stringify(REST));
    await expect(readRestSession()).resolves.toEqual(REST);
  });

  it('discards malformed JSON safely', async () => {
    storage.getItem.mockResolvedValueOnce('{invalid');
    await expect(readRestSession()).resolves.toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(REST_SESSION_STORAGE_KEY);
  });

  it('discards a structurally invalid rest safely', async () => {
    storage.getItem.mockResolvedValueOnce(JSON.stringify({ ...REST, endsAt: 1 }));
    await expect(readRestSession()).resolves.toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(REST_SESSION_STORAGE_KEY);
  });

  it('clears the persisted transition explicitly', async () => {
    await clearRestSession();
    expect(storage.removeItem).toHaveBeenCalledWith(REST_SESSION_STORAGE_KEY);
  });
});
