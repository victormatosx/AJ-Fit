import { describe, expect, it } from 'vitest';
import type { CollectionReference } from 'firebase-admin/firestore';

import { deleteCollectionDocuments } from '../deleteCollectionDocuments';
import { createFakeFirestore } from './fakeFirestore';

function seedMany(harness: ReturnType<typeof createFakeFirestore>, prefix: string, count: number) {
  for (let i = 0; i < count; i++) {
    harness.seed(`${prefix}/doc-${String(i).padStart(4, '0')}`);
  }
}

describe('deleteCollectionDocuments — empty/missing (logical success)', () => {
  it('an empty collection returns deletedCount: 0, never an error', async () => {
    const harness = createFakeFirestore();
    const collection = harness.db.collection('users/uid-1/assessments') as unknown as CollectionReference;
    await expect(deleteCollectionDocuments(collection)).resolves.toEqual({ deletedCount: 0 });
  });
});

describe('deleteCollectionDocuments — basic delete', () => {
  it('deletes every document in a small collection', async () => {
    const harness = createFakeFirestore();
    seedMany(harness, 'users/uid-1/assessments', 5);
    const collection = harness.db.collection('users/uid-1/assessments') as unknown as CollectionReference;

    const result = await deleteCollectionDocuments(collection);

    expect(result).toEqual({ deletedCount: 5 });
    expect(harness.listUnder('users/uid-1/assessments/')).toEqual([]);
  });
});

describe('deleteCollectionDocuments — pagination/scale (Fase 6 §18/§43)', () => {
  it('deletes hundreds of documents across multiple pages', async () => {
    const harness = createFakeFirestore();
    seedMany(harness, 'users/uid-1/assessments', 725);
    const collection = harness.db.collection('users/uid-1/assessments') as unknown as CollectionReference;

    const result = await deleteCollectionDocuments(collection, 100); // force small page size

    expect(result).toEqual({ deletedCount: 725 });
    expect(harness.listUnder('users/uid-1/assessments/')).toHaveLength(0);
  });
});

describe('deleteCollectionDocuments — idempotency (retry)', () => {
  it('running it a second time after full deletion returns deletedCount: 0', async () => {
    const harness = createFakeFirestore();
    seedMany(harness, 'users/uid-1/assessments', 10);
    const collection = harness.db.collection('users/uid-1/assessments') as unknown as CollectionReference;

    await deleteCollectionDocuments(collection);
    const second = await deleteCollectionDocuments(collection);

    expect(second).toEqual({ deletedCount: 0 });
  });

  it('deleting an already-absent document (e.g. removed by a racing process) is a no-op, never an error', async () => {
    const harness = createFakeFirestore();
    const collection = harness.db.collection('users/uid-1/assessments') as unknown as CollectionReference;
    const ghostDoc = harness.db.collection('users/uid-1/assessments').doc('ghost');

    // The document was never actually seeded (or was already removed by
    // another process) — deleting it directly must still succeed silently,
    // matching real Firestore delete semantics.
    await expect(ghostDoc.delete()).resolves.toBeUndefined();
    await expect(deleteCollectionDocuments(collection)).resolves.toEqual({ deletedCount: 0 });
  });
});

describe('deleteCollectionDocuments — retry after partial failure (Fase 6 §21)', () => {
  it('a flush failure propagates, and a subsequent retry finishes the remaining work', async () => {
    const harness = createFakeFirestore();
    seedMany(harness, 'users/uid-1/assessments', 10);
    const collection = harness.db.collection('users/uid-1/assessments') as unknown as CollectionReference;

    harness.failNextBulkWriterClose(new Error('simulated transient failure'));
    await expect(deleteCollectionDocuments(collection)).rejects.toThrow('simulated transient failure');

    // The failed close() never applied the deletes (fake models this as an
    // all-or-nothing flush failure) — all 10 remain for the retry to find.
    expect(harness.listUnder('users/uid-1/assessments/')).toHaveLength(10);

    const retry = await deleteCollectionDocuments(collection);
    expect(retry).toEqual({ deletedCount: 10 });
    expect(harness.listUnder('users/uid-1/assessments/')).toHaveLength(0);
  });
});

describe('deleteCollectionDocuments — other uid isolation', () => {
  it('never touches documents outside the given collection path', async () => {
    const harness = createFakeFirestore();
    seedMany(harness, 'users/uid-A/assessments', 5);
    seedMany(harness, 'users/uid-B/assessments', 5);
    const collectionA = harness.db.collection('users/uid-A/assessments') as unknown as CollectionReference;

    await deleteCollectionDocuments(collectionA);

    expect(harness.listUnder('users/uid-A/assessments/')).toHaveLength(0);
    expect(harness.listUnder('users/uid-B/assessments/')).toHaveLength(5);
  });
});

describe('deleteCollectionDocuments — concurrency', () => {
  it('two concurrent invocations over the same collection both converge on empty', async () => {
    const harness = createFakeFirestore();
    seedMany(harness, 'users/uid-1/assessments', 50);
    const collection = harness.db.collection('users/uid-1/assessments') as unknown as CollectionReference;

    const [a, b] = await Promise.all([
      deleteCollectionDocuments(collection),
      deleteCollectionDocuments(collection),
    ]);

    expect(a.deletedCount + b.deletedCount).toBeGreaterThanOrEqual(50);
    expect(harness.listUnder('users/uid-1/assessments/')).toHaveLength(0);
  });
});
