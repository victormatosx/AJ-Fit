import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

const state = vi.hoisted(() => ({
  now: Date.UTC(2026, 7, 12),
  files: new Map<string, FakeFile>(),
  photos: new Map<string, FakePhotoDocument>(),
  markers: new Map<string, Record<string, unknown>>(),
}));

class FakeFile {
  deleted = false;
  failMetadata = false;

  constructor(
    readonly name: string,
    readonly createdAtMillis: number,
    readonly generation = '7',
  ) {}

  async getMetadata() {
    if (this.failMetadata) throw Object.assign(new Error('metadata failure'), { code: 500 });
    return [
      {
        timeCreated: new Date(this.createdAtMillis).toISOString(),
        generation: this.generation,
      },
    ];
  }

  async exists() {
    return [!this.deleted];
  }

  async delete(options?: { ifGenerationMatch?: number }) {
    if (options?.ifGenerationMatch !== Number(this.generation)) {
      throw new Error('generation mismatch');
    }
    this.deleted = true;
  }
}

class FakePhotoDocument {
  deleted = false;

  constructor(
    readonly path: string,
    readonly storagePath: string,
    readonly thumbnailStoragePath?: string,
    readonly updateTime = Timestamp.fromMillis(state.now - 1000),
  ) {}

  get ref() {
    return this;
  }

  get exists() {
    return !this.deleted;
  }

  data() {
    return {
      storagePath: this.storagePath,
      ...(this.thumbnailStoragePath ? { thumbnailStoragePath: this.thumbnailStoragePath } : {}),
    };
  }

  async get() {
    return this;
  }

  async delete(options?: { lastUpdateTime?: Timestamp }) {
    if (options?.lastUpdateTime?.toMillis() !== this.updateTime.toMillis()) {
      throw new Error('update time mismatch');
    }
    this.deleted = true;
  }
}

vi.mock('../lib/firebaseAdmin', () => {
  const photoByPath = (path: string) => state.photos.get(path);
  return {
    db: {
      doc(path: string) {
        return {
          async get() {
            const photo = photoByPath(path);
            return photo ?? { exists: false, data: () => undefined };
          },
        };
      },
      collection(name: string) {
        if (name !== '_photoVaultCleanupCandidates') throw new Error('wrong collection');
        return {
          doc(id: string) {
            return {
              async get() {
                const data = state.markers.get(id);
                return { data: () => data };
              },
              async set(data: Record<string, unknown>) {
                state.markers.set(id, {
                  ...data,
                  firstSeenAt: Timestamp.fromMillis(state.now),
                });
              },
              async delete() {
                state.markers.delete(id);
              },
            };
          },
        };
      },
      collectionGroup(name: string) {
        if (name !== 'progressPhotos') throw new Error('wrong collection group');
        return {
          where() {
            return this;
          },
          orderBy() {
            return this;
          },
          limit() {
            return this;
          },
          async get() {
            return { docs: [...state.photos.values()].filter((photo) => photo.exists) };
          },
        };
      },
    },
  };
});

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      async getFiles() {
        return [[...state.files.values()].filter((file) => !file.deleted)];
      },
      file(path: string) {
        return (
          state.files.get(path) ?? {
            async exists() {
              return [false];
            },
          }
        );
      },
    }),
  }),
}));

vi.mock('../lib/logger', () => ({
  logInfo: vi.fn(),
  logFunctionError: vi.fn(),
}));

import { runPhotoVaultOrphanCleanup } from '../photoVault/cleanupOrphans';
import {
  ORPHAN_CONFIRMATION_MS,
  ORPHAN_MIN_AGE_MS,
} from '../photoVault/orphanPolicy';

const ID_A = '123e4567-e89b-42d3-a456-426614174000';
const ID_B = '123e4567-e89b-42d3-a456-426614174001';

function storagePath(id: string): string {
  return `users/alice/progressPhotos/${id}.enc`;
}

function thumbnailPath(id: string): string {
  return `users/alice/progressPhotos/${id}.thumb.enc`;
}

function firestorePath(id: string): string {
  return `users/alice/progressPhotos/${id}`;
}

beforeEach(() => {
  state.now = Date.UTC(2026, 7, 12);
  state.files.clear();
  state.photos.clear();
  state.markers.clear();
  vi.clearAllMocks();
});

describe('scheduled Photo Vault reconciliation', () => {
  it('preserves a recent Storage object with no Firestore metadata', async () => {
    const file = new FakeFile(storagePath(ID_A), state.now - ORPHAN_MIN_AGE_MS + 1);
    state.files.set(file.name, file);

    const result = await runPhotoVaultOrphanCleanup(state.now);

    expect(file.deleted).toBe(false);
    expect(state.markers.size).toBe(0);
    expect(result.preserved).toBe(1);
  });

  it('preserves an old Storage object when its Firestore document exists', async () => {
    const path = storagePath(ID_A);
    const file = new FakeFile(path, state.now - ORPHAN_MIN_AGE_MS);
    state.files.set(path, file);
    state.photos.set(firestorePath(ID_A), new FakePhotoDocument(firestorePath(ID_A), path));

    await runPhotoVaultOrphanCleanup(state.now);

    expect(file.deleted).toBe(false);
    expect(state.markers.size).toBe(0);
  });

  it('preserves an old thumbnail only when the document links that exact asset', async () => {
    const fullPath = storagePath(ID_A);
    const thumbPath = thumbnailPath(ID_A);
    const full = new FakeFile(fullPath, state.now - ORPHAN_MIN_AGE_MS);
    const thumbnail = new FakeFile(thumbPath, state.now - ORPHAN_MIN_AGE_MS);
    state.files.set(fullPath, full);
    state.files.set(thumbPath, thumbnail);
    state.photos.set(
      firestorePath(ID_A),
      new FakePhotoDocument(firestorePath(ID_A), fullPath, thumbPath),
    );

    await runPhotoVaultOrphanCleanup(state.now);
    expect(thumbnail.deleted).toBe(false);
    expect(state.markers.size).toBe(0);
  });

  it('reclaims an old unlinked thumbnail after the confirmation window', async () => {
    const thumbPath = thumbnailPath(ID_A);
    const thumbnail = new FakeFile(thumbPath, state.now - ORPHAN_MIN_AGE_MS);
    state.files.set(thumbPath, thumbnail);
    state.photos.set(
      firestorePath(ID_A),
      new FakePhotoDocument(firestorePath(ID_A), storagePath(ID_A)),
    );

    await runPhotoVaultOrphanCleanup(state.now);
    state.now += ORPHAN_CONFIRMATION_MS;
    await runPhotoVaultOrphanCleanup(state.now);
    expect(thumbnail.deleted).toBe(true);
  });

  it('deletes an old orphan object only after a second confirmed observation', async () => {
    const file = new FakeFile(storagePath(ID_A), state.now - ORPHAN_MIN_AGE_MS);
    state.files.set(file.name, file);

    const first = await runPhotoVaultOrphanCleanup(state.now);
    expect(first.marked).toBe(1);
    expect(file.deleted).toBe(false);

    state.now += ORPHAN_CONFIRMATION_MS;
    const second = await runPhotoVaultOrphanCleanup(state.now);

    expect(second.deletedObjects).toBe(1);
    expect(file.deleted).toBe(true);
  });

  it('reconciles old Firestore metadata whose Storage object remains absent', async () => {
    const photo = new FakePhotoDocument(firestorePath(ID_A), storagePath(ID_A));
    state.photos.set(photo.path, photo);

    const first = await runPhotoVaultOrphanCleanup(state.now);
    expect(first.marked).toBe(1);
    expect(photo.deleted).toBe(false);

    state.now += ORPHAN_CONFIRMATION_MS;
    const second = await runPhotoVaultOrphanCleanup(state.now);

    expect(second.deletedDocuments).toBe(1);
    expect(photo.deleted).toBe(true);
  });

  it('continues the batch after one candidate fails', async () => {
    const broken = new FakeFile(storagePath(ID_A), state.now - ORPHAN_MIN_AGE_MS);
    broken.failMetadata = true;
    const healthy = new FakeFile(storagePath(ID_B), state.now - ORPHAN_MIN_AGE_MS);
    state.files.set(broken.name, broken);
    state.files.set(healthy.name, healthy);

    const result = await runPhotoVaultOrphanCleanup(state.now);

    expect(result.failed).toBe(1);
    expect(result.marked).toBe(1);
    expect(healthy.deleted).toBe(false);
  });
});
