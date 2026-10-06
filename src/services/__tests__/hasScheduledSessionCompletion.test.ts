import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for the audit finding: `hasScheduledSessionCompletion`
 * must check the exact occurrence of a COMPLETED event, not always
 * occurrence 1's id — otherwise a `flexible` schedule's same-day occurrence
 * 2+ is misread as "already recorded" whenever an earlier occurrence that
 * same day really did complete (`src/scheduleEngine/useWorkoutSchedule.ts`'s
 * process-death recovery used to omit `occurrence` entirely).
 */
const mocks = vi.hoisted(() => ({
  doc: vi.fn((..._args: unknown[]) => ({ _path: _args.slice(1).join('/') })),
  getDoc: vi.fn(),
  collection: vi.fn((..._args: unknown[]) => ({ _path: _args.slice(1).join('/') })),
}));

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  getDocs: vi.fn(),
  query: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  where: vi.fn(),
}));
vi.mock('../../lib/firebase', () => ({ db: { kind: 'db' } }));
vi.mock('../../lib/perf', () => ({ countFirestoreRead: vi.fn() }));

// eslint-disable-next-line import/first
import { hasScheduledSessionCompletion } from '../workoutSchedule';

function existsRefMatching(predicate: (path: string) => boolean) {
  mocks.getDoc.mockImplementation(async (ref: { _path: string }) => ({
    exists: () => predicate(ref._path),
  }));
}

describe('hasScheduledSessionCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.doc.mockImplementation((..._args: unknown[]) => ({ _path: _args.slice(1).join('/') }));
    mocks.collection.mockImplementation((..._args: unknown[]) => ({ _path: _args.slice(1).join('/') }));
  });

  it('checks the occurrence-1 (base) id when occurrence is omitted', async () => {
    existsRefMatching((path) => path.endsWith('completed_0_2026-10-03'));
    await expect(hasScheduledSessionCompletion({
      uid: 'u1', programId: 'p1', sessionIndex: 0, scheduledLocalDate: '2026-10-03',
    })).resolves.toBe(true);
  });

  it('checks the occurrence-1 (base) id when occurrence is explicitly 1', async () => {
    existsRefMatching((path) => path.endsWith('completed_0_2026-10-03'));
    await expect(hasScheduledSessionCompletion({
      uid: 'u1', programId: 'p1', sessionIndex: 0, scheduledLocalDate: '2026-10-03', occurrence: 1,
    })).resolves.toBe(true);
  });

  it('checks the distinct occurrence-2 id, never falling back to occurrence 1', async () => {
    // Only occurrence 1's event exists; occurrence 2's does not.
    existsRefMatching((path) => path.endsWith('completed_0_2026-10-03') && !path.includes('_o2'));
    await expect(hasScheduledSessionCompletion({
      uid: 'u1', programId: 'p1', sessionIndex: 0, scheduledLocalDate: '2026-10-03', occurrence: 2,
    })).resolves.toBe(false);
  });

  it('reports true once occurrence-2 has its own recorded event', async () => {
    existsRefMatching((path) => path.endsWith('completed_0_2026-10-03_o2'));
    await expect(hasScheduledSessionCompletion({
      uid: 'u1', programId: 'p1', sessionIndex: 0, scheduledLocalDate: '2026-10-03', occurrence: 2,
    })).resolves.toBe(true);
  });

  it('scopes the id by programInstanceId when present, independent of occurrence', async () => {
    existsRefMatching((path) => path.endsWith('wpi_1_completed_0_2026-10-03_o2'));
    await expect(hasScheduledSessionCompletion({
      uid: 'u1', programId: 'p1', programInstanceId: 'wpi_1', sessionIndex: 0, scheduledLocalDate: '2026-10-03', occurrence: 2,
    })).resolves.toBe(true);
    await expect(hasScheduledSessionCompletion({
      uid: 'u1', programId: 'p1', programInstanceId: 'wpi_1', sessionIndex: 0, scheduledLocalDate: '2026-10-03', occurrence: 1,
    })).resolves.toBe(false);
  });
});
