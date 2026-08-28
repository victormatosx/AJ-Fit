import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getDocs: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  collection: (...path: unknown[]) => ({ path: path.slice(1).join('/') }),
  documentId: () => '__name__',
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (base: unknown, ...clauses: unknown[]) => ({ base, clauses }),
  getDocs: (...args: unknown[]) => mocks.getDocs(...args),
}));
vi.mock('../../lib/firebase', () => ({ db: {} }));

import { loadExerciseExecutionMedia } from '../exerciseExecutionMedia';

function fakeSnapshot(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
}

describe('loadExerciseExecutionMedia', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a map keyed by exercise id, containing only the execution field', async () => {
    mocks.getDocs.mockResolvedValueOnce(
      fakeSnapshot([
        { id: 'machine-shoulder-press', data: { execution: { videos: { vertical: { url: 'https://x/v.mp4', storagePath: 'v' } } }, name: { ptBR: 'x' } } },
      ]),
    );
    const media = await loadExerciseExecutionMedia(['machine-shoulder-press']);
    expect(media).toEqual({
      'machine-shoulder-press': { videos: { vertical: { url: 'https://x/v.mp4', storagePath: 'v' } } },
    });
  });

  it('omits ids with no document, no execution, or a malformed execution', async () => {
    mocks.getDocs.mockResolvedValueOnce(
      fakeSnapshot([
        { id: 'has-execution', data: { execution: {} } },
        { id: 'null-execution', data: { execution: null } },
        { id: 'no-execution-field', data: {} },
      ]),
    );
    const media = await loadExerciseExecutionMedia(['has-execution', 'null-execution', 'no-execution-field', 'never-returned']);
    expect(Object.keys(media)).toEqual(['has-execution']);
  });

  it('returns {} for an empty id list without querying Firestore', async () => {
    const media = await loadExerciseExecutionMedia([]);
    expect(media).toEqual({});
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it('deduplicates ids and batches queries in chunks of at most 30', async () => {
    const ids = Array.from({ length: 65 }, (_, i) => `ex-${i}`);
    mocks.getDocs.mockResolvedValue(fakeSnapshot([]));
    await loadExerciseExecutionMedia([...ids, ...ids]); // duplicated on purpose
    expect(mocks.getDocs).toHaveBeenCalledTimes(3); // 65 unique ids -> 30 + 30 + 5
  });

  it('never throws — a Firestore failure resolves to {} so the UI can fall through to its fallback library', async () => {
    mocks.getDocs.mockRejectedValueOnce(new Error('offline'));
    const media = await loadExerciseExecutionMedia(['some-id']);
    expect(media).toEqual({});
  });
});
