import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  collection: vi.fn(() => ({ path: 'preferences' })),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  next: null as null | ((snapshot: { docs: { id: string; data: () => Record<string, unknown> }[]; size: number }) => void),
  error: null as null | ((error: { code: string }) => void),
  unsubscribe: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  getDocs: mocks.getDocs,
  onSnapshot: mocks.onSnapshot,
}));
vi.mock('../../lib/firebase', () => ({ db: { kind: 'db' } }));
vi.mock('../../lib/logger', () => ({ logInfo: vi.fn(), logWarn: mocks.logWarn }));

// Imports intentionally follow the hoisted module mocks in this Node test.
// eslint-disable-next-line import/first
import {
  loadPermanentExerciseSubstitutionPreferences,
  permanentExerciseSubstitutionPreferencesFromDocuments,
  subscribeToPermanentExerciseSubstitutionPreferences,
} from '../exerciseSubstitutionPreferences';

function snapshot(entries: [string, unknown][]) {
  return {
    docs: entries.map(([id, preferredExerciseId]) => ({
      id,
      data: () => ({ preferredExerciseId }),
    })),
    size: entries.length,
  };
}

describe('permanent exercise substitution preference loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.next = null;
    mocks.error = null;
    mocks.onSnapshot.mockImplementation((_ref, next, error) => {
      mocks.next = next;
      mocks.error = error;
      return mocks.unsubscribe;
    });
  });

  it('parses prescribed-id -> preferred-id and ignores malformed entries', () => {
    const result = permanentExerciseSubstitutionPreferencesFromDocuments(snapshot([
      ['barbell-back-squat', 'goblet-squat'],
      ['malformed', 123],
    ]).docs);
    expect([...result]).toEqual([['barbell-back-squat', 'goblet-squat']]);
  });

  it('loads the entire collection with one query, never one query per exercise/card', async () => {
    mocks.getDocs.mockResolvedValueOnce(snapshot([
      ['a', 'x'],
      ['b', 'y'],
      ['c', 'z'],
    ]));
    await expect(loadPermanentExerciseSubstitutionPreferences('uid-1')).resolves.toEqual(
      new Map([['a', 'x'], ['b', 'y'], ['c', 'z']]),
    );
    expect(mocks.collection).toHaveBeenCalledTimes(1);
    expect(mocks.collection).toHaveBeenCalledWith(
      { kind: 'db' }, 'users', 'uid-1', 'exerciseSubstitutionPreferences',
    );
    expect(mocks.getDocs).toHaveBeenCalledTimes(1);
  });

  it('reacts to preference creation and removal through one non-polling collection listener', () => {
    const received: [string, string][][] = [];
    const unsubscribe = subscribeToPermanentExerciseSubstitutionPreferences(
      'uid-1',
      (preferences) => received.push([...preferences]),
    );
    mocks.next?.(snapshot([['barbell-back-squat', 'goblet-squat']]));
    mocks.next?.(snapshot([]));

    expect(received).toEqual([[['barbell-back-squat', 'goblet-squat']], []]);
    expect(mocks.collection).toHaveBeenCalledTimes(1);
    expect(mocks.onSnapshot).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toBe(mocks.unsubscribe);
  });

  it('fails open to an empty preference map when the listener cannot load', () => {
    const received: [string, string][][] = [];
    subscribeToPermanentExerciseSubstitutionPreferences(
      'uid-1',
      (preferences) => received.push([...preferences]),
    );
    mocks.error?.({ code: 'permission-denied' });
    expect(received).toEqual([[]]);
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'my_plan',
      'substitution_preferences_failed_fail_open',
      expect.objectContaining({ code: 'permission-denied' }),
    );
  });
});
