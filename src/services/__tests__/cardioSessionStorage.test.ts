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

import { createCardioSession, startCardio } from '../../lib/cardioTimer';
import { logError } from '../../lib/logger';
import {
  CARDIO_SESSION_STORAGE_KEY,
  clearCardioSession,
  persistCardioSession,
  readCardioSession,
} from '../cardioSessionStorage';

const SESSION = startCardio(
  createCardioSession({
    cardioSessionId: 'cardio-storage',
    workoutSessionId: 'exec-storage',
    plannedDurationSeconds: 1200,
  }),
  100_000,
);

beforeEach(() => {
  vi.clearAllMocks();
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockResolvedValue(undefined);
  storage.removeItem.mockResolvedValue(undefined);
});

describe('cardioSessionStorage', () => {
  it('persists the complete session only on an explicit transition', async () => {
    await persistCardioSession(SESSION);
    expect(storage.setItem).toHaveBeenCalledWith(
      CARDIO_SESSION_STORAGE_KEY,
      JSON.stringify(SESSION),
    );
  });

  it('reads a valid persisted session', async () => {
    storage.getItem.mockResolvedValueOnce(JSON.stringify(SESSION));
    await expect(readCardioSession()).resolves.toEqual(SESSION);
  });

  it('discards malformed JSON safely', async () => {
    storage.getItem.mockResolvedValueOnce('{invalid');
    await expect(readCardioSession()).resolves.toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(CARDIO_SESSION_STORAGE_KEY);
  });

  it('discards a structurally invalid session safely', async () => {
    storage.getItem.mockResolvedValueOnce(JSON.stringify({ ...SESSION, status: 'RUNNING', cardioStartedAt: null }));
    await expect(readCardioSession()).resolves.toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(CARDIO_SESSION_STORAGE_KEY);
  });

  it('clears the persisted session explicitly', async () => {
    await clearCardioSession();
    expect(storage.removeItem).toHaveBeenCalledWith(CARDIO_SESSION_STORAGE_KEY);
  });

  it('observes a clear failure without rejecting the durable completion task', async () => {
    const failure = new Error('storage unavailable');
    storage.removeItem.mockRejectedValueOnce(failure);

    await expect(clearCardioSession()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith('cardioSessionStorage:clear', failure);
  });
});
