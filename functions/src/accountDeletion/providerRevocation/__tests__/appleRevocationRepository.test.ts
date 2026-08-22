import { describe, expect, it, vi } from 'vitest';

/**
 * Fakes only `db.collection(...).doc(...).collection(...).doc(...)` — the
 * exact chain `appleRevocationRepository.ts` calls — never a real Firestore
 * connection. Mirrors the in-memory-map style already used elsewhere in
 * this backend's test suite for Admin SDK-backed repositories.
 */
function fakeFirestore() {
  const store = new Map<string, unknown>();

  function doc(path: string) {
    return {
      set: vi.fn(async (data: unknown) => {
        store.set(path, data);
      }),
      get: vi.fn(async () => ({
        exists: store.has(path),
        data: () => store.get(path),
      })),
      delete: vi.fn(async () => {
        store.delete(path);
      }),
      collection: (sub: string) => ({
        doc: (id: string) => doc(`${path}/${sub}/${id}`),
      }),
    };
  }

  return {
    store,
    db: {
      collection: (name: string) => ({
        doc: (id: string) => doc(`${name}/${id}`),
      }),
    },
  };
}

const fake = vi.hoisted(() => fakeFirestore());
vi.mock('../../../lib/firebaseAdmin', () => ({ db: fake.db }));

import { FirestoreAppleRevocationMaterialRepository } from '../appleRevocationRepository';

describe('FirestoreAppleRevocationMaterialRepository', () => {
  it('returns null when nothing has been saved yet', async () => {
    const repo = new FirestoreAppleRevocationMaterialRepository();
    await expect(repo.read('del-none')).resolves.toBeNull();
  });

  it('round-trips saved material', async () => {
    const repo = new FirestoreAppleRevocationMaterialRepository();
    const material = { wrappedRefreshToken: 'cipher', kmsKeyVersion: 'v1', createdAtMs: 123 };
    await repo.save('del-1', material);
    await expect(repo.read('del-1')).resolves.toEqual(material);
  });

  it('clear() removes the material so a subsequent read returns null', async () => {
    const repo = new FirestoreAppleRevocationMaterialRepository();
    await repo.save('del-2', { wrappedRefreshToken: 'c', kmsKeyVersion: 'v1', createdAtMs: 1 });
    await repo.clear('del-2');
    await expect(repo.read('del-2')).resolves.toBeNull();
  });

  it('scopes material by deletionId — one deletion never sees another’s material', async () => {
    const repo = new FirestoreAppleRevocationMaterialRepository();
    await repo.save('del-a', { wrappedRefreshToken: 'a', kmsKeyVersion: 'v1', createdAtMs: 1 });
    await repo.save('del-b', { wrappedRefreshToken: 'b', kmsKeyVersion: 'v1', createdAtMs: 2 });
    await expect(repo.read('del-a')).resolves.toMatchObject({ wrappedRefreshToken: 'a' });
    await expect(repo.read('del-b')).resolves.toMatchObject({ wrappedRefreshToken: 'b' });
  });

  it('treats a malformed stored document as absent rather than trusting it', async () => {
    const repo = new FirestoreAppleRevocationMaterialRepository();
    fake.store.set('accountDeletions/del-bad/privateSecurity/appleProviderRevocation', { garbage: true });
    await expect(repo.read('del-bad')).resolves.toBeNull();
  });
});
