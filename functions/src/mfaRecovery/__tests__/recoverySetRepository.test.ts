import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeFirestore } from './fakeFirestore';

const fake = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { current: null as any };
});

vi.mock('../../lib/firebaseAdmin', () => ({
  get db() {
    return fake.current.db;
  },
  auth: {},
}));

import { RECOVERY_DIGEST_ALGORITHM, RECOVERY_DIGEST_BYTES } from '../digest';
import {
  RecoverySelectorTakenError,
  getActiveRecoverySetForUid,
  getRecoveryPointer,
  getRecoverySetById,
  persistNewRecoverySet,
} from '../recoverySetRepository';
import {
  MFA_RECOVERY_COLLECTION,
  MFA_RECOVERY_POINTER_COLLECTION,
  RECOVERY_SCHEMA_VERSION,
  type RecoverySetDocument,
} from '../schema';

const UID = 'alice';
const NOW = new Date('2026-08-19T10:00:00Z');

function digest(seed: number): string {
  return Buffer.alloc(RECOVERY_DIGEST_BYTES, seed).toString('base64');
}

function buildSet(recoverySetId: string, version: number): RecoverySetDocument {
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    recoverySetId,
    uid: UID,
    version,
    pepperVersion: 1,
    digestVersion: 1,
    digestAlgorithm: RECOVERY_DIGEST_ALGORITHM,
    status: 'active',
    createdAt: NOW,
    rotatedAt: null,
    codes: [1, 2, 3].map((index) => ({
      id: `code-${index}`,
      digest: digest(index + recoverySetId.charCodeAt(0)),
      state: 'available' as const,
      createdAt: NOW,
      reservedAt: null,
      consumedAt: null,
      operationId: null,
    })),
    rateLimit: { attempts: 0, windowStartedAt: null, lastAttemptAt: null, blockedUntil: null },
    activeOperation: null,
  };
}

function builderFor(recoverySetId: string) {
  return ({ version }: { version: number }) => buildSet(recoverySetId, version);
}

beforeEach(() => {
  fake.current = createFakeFirestore();
});

describe('persistNewRecoverySet — first set for a user', () => {
  it('creates the set and points the user at it', async () => {
    const result = await persistNewRecoverySet(UID, builderFor('SELECTORAAAA'), NOW);

    expect(result).toEqual({
      recoverySetId: 'SELECTORAAAA',
      rotatedSetId: null,
      version: 1,
    });

    const stored = fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA');
    expect(stored?.status).toBe('active');
    expect(stored?.uid).toBe(UID);

    const pointer = fake.current.read(MFA_RECOVERY_POINTER_COLLECTION, UID);
    expect(pointer?.activeSetId).toBe('SELECTORAAAA');
    expect(pointer?.uid).toBe(UID);
  });

  it('starts the rotation generation at 1', async () => {
    const result = await persistNewRecoverySet(UID, builderFor('SELECTORAAAA'), NOW);
    expect(result.version).toBe(1);
  });

  it('persists no plaintext recovery code', async () => {
    await persistNewRecoverySet(UID, builderFor('SELECTORAAAA'), NOW);

    const serialized = JSON.stringify(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA'));

    expect(serialized).not.toContain('AJF');
    for (const forbidden of ['plaintext', 'plainCode', 'rawCode', 'recoveryCode']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('rejects a document that fails the closed schema', async () => {
    await expect(
      persistNewRecoverySet(
        UID,
        ({ version }) =>
          ({ ...buildSet('SELECTORAAAA', version), status: 'bogus' }) as never,
        NOW,
      ),
    ).rejects.toThrow(/Invalid recovery set/);

    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA')).toBeUndefined();
  });
});

describe('persistNewRecoverySet — rotation', () => {
  beforeEach(async () => {
    await persistNewRecoverySet(UID, builderFor('SELECTORAAAA'), NOW);
  });

  it('moves the previous set to rotated and repoints', async () => {
    const later = new Date('2026-08-19T11:00:00Z');
    const result = await persistNewRecoverySet(UID, builderFor('SELECTORBBBB'), later);

    expect(result.rotatedSetId).toBe('SELECTORAAAA');
    expect(result.version).toBe(2);

    const previous = fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA');
    expect(previous?.status).toBe('rotated');
    expect(previous?.rotatedAt).toEqual(later);

    const current = fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORBBBB');
    expect(current?.status).toBe('active');

    expect(fake.current.read(MFA_RECOVERY_POINTER_COLLECTION, UID)?.activeSetId).toBe(
      'SELECTORBBBB',
    );
  });

  it('leaves exactly one active set', async () => {
    await persistNewRecoverySet(UID, builderFor('SELECTORBBBB'), NOW);
    await persistNewRecoverySet(UID, builderFor('SELECTORCCCC'), NOW);

    const active = [...fake.current.store.entries()].filter(
      ([key, value]) =>
        key.startsWith(`${MFA_RECOVERY_COLLECTION}/`) && value.data.status === 'active',
    );

    expect(active).toHaveLength(1);
    expect(active[0][0]).toBe(`${MFA_RECOVERY_COLLECTION}/SELECTORCCCC`);
  });

  it('increments the version across rotations', async () => {
    expect((await persistNewRecoverySet(UID, builderFor('SELECTORBBBB'), NOW)).version).toBe(2);
    expect((await persistNewRecoverySet(UID, builderFor('SELECTORCCCC'), NOW)).version).toBe(3);
  });

  it('repairs a stale pointer that names an already-rotated set', async () => {
    // Simulates a rotation interrupted after the set moved but before the
    // pointer did: the pointer is rebuilt, and nothing is rotated twice.
    fake.current.seed(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA', {
      ...fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA'),
      status: 'rotated',
      rotatedAt: NOW,
    });

    const result = await persistNewRecoverySet(UID, builderFor('SELECTORBBBB'), NOW);

    expect(result.rotatedSetId).toBeNull();
    expect(fake.current.read(MFA_RECOVERY_POINTER_COLLECTION, UID)?.activeSetId).toBe(
      'SELECTORBBBB',
    );
  });

  it('tolerates a pointer naming a set that no longer exists', async () => {
    fake.current.store.delete(`${MFA_RECOVERY_COLLECTION}/SELECTORAAAA`);

    const result = await persistNewRecoverySet(UID, builderFor('SELECTORBBBB'), NOW);

    expect(result.rotatedSetId).toBeNull();
    expect(result.recoverySetId).toBe('SELECTORBBBB');
  });
});

describe('persistNewRecoverySet — selector collision', () => {
  it('never overwrites an existing set', async () => {
    fake.current.seed(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA', {
      uid: 'someone-else',
      status: 'active',
      sentinel: 'untouched',
    });

    await expect(
      persistNewRecoverySet(UID, builderFor('SELECTORAAAA'), NOW),
    ).rejects.toBeInstanceOf(RecoverySelectorTakenError);

    // The victim's document is byte-for-byte intact.
    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA')).toEqual({
      uid: 'someone-else',
      status: 'active',
      sentinel: 'untouched',
    });
  });

  it('does not repoint the user when the create fails', async () => {
    fake.current.seed(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA', { status: 'active' });

    await expect(persistNewRecoverySet(UID, builderFor('SELECTORAAAA'), NOW)).rejects.toThrow();

    expect(fake.current.read(MFA_RECOVERY_POINTER_COLLECTION, UID)).toBeUndefined();
  });

  it('surfaces a collision created mid-transaction', async () => {
    // Another writer takes the selector between our read and our commit.
    fake.current = createFakeFirestore({
      onBeforeCommit: (attempt, store) => {
        if (attempt === 1) {
          store.set(`${MFA_RECOVERY_COLLECTION}/SELECTORAAAA`, {
            data: { status: 'active', uid: 'racer' },
            version: 1,
          });
        }
      },
    });

    await expect(
      persistNewRecoverySet(UID, builderFor('SELECTORAAAA'), NOW),
    ).rejects.toBeInstanceOf(RecoverySelectorTakenError);
  });
});

describe('persistNewRecoverySet — concurrency', () => {
  it('serializes two generations for the same uid into one active set', async () => {
    // A competing generation commits between our read and our commit, so our
    // transaction is aborted and retried against the winner's state.
    let injected = false;
    fake.current = createFakeFirestore({
      onBeforeCommit: (attempt, store) => {
        if (attempt === 1 && !injected) {
          injected = true;
          store.set(`${MFA_RECOVERY_COLLECTION}/SELECTORZZZZ`, {
            data: { ...buildSet('SELECTORZZZZ', 1), status: 'active' },
            version: 1,
          });
          store.set(`${MFA_RECOVERY_POINTER_COLLECTION}/${UID}`, {
            data: { schemaVersion: 1, uid: UID, activeSetId: 'SELECTORZZZZ', updatedAt: NOW },
            version: 1,
          });
        }
      },
    });

    const result = await persistNewRecoverySet(UID, builderFor('SELECTORBBBB'), NOW);

    // Our retry observed the competitor and rotated it, rather than leaving
    // two active sets or silently overwriting the pointer.
    expect(result.rotatedSetId).toBe('SELECTORZZZZ');
    expect(result.version).toBe(2);

    const active = [...fake.current.store.entries()].filter(
      ([key, value]) =>
        key.startsWith(`${MFA_RECOVERY_COLLECTION}/`) && value.data.status === 'active',
    );
    expect(active).toHaveLength(1);
    expect(active[0][0]).toBe(`${MFA_RECOVERY_COLLECTION}/SELECTORBBBB`);
  });

  it('never leaves a partially written state when the transaction aborts', async () => {
    // A writer that keeps winning: every attempt is stale, so we exhaust the
    // retry budget and commit nothing at all.
    fake.current = createFakeFirestore({
      maxAttempts: 3,
      onBeforeCommit: (attempt, store) => {
        store.set(`${MFA_RECOVERY_POINTER_COLLECTION}/${UID}`, {
          data: { schemaVersion: 1, uid: UID, activeSetId: `OTHER${attempt}`, updatedAt: NOW },
          version: 100 + attempt,
        });
      },
    });

    await expect(persistNewRecoverySet(UID, builderFor('SELECTORBBBB'), NOW)).rejects.toThrow();

    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORBBBB')).toBeUndefined();
  });

  it('propagates an infrastructure failure without writing anything', async () => {
    fake.current.db.runTransaction = async () => {
      throw new Error('FIRESTORE_UNAVAILABLE');
    };

    await expect(persistNewRecoverySet(UID, builderFor('SELECTORBBBB'), NOW)).rejects.toThrow(
      'FIRESTORE_UNAVAILABLE',
    );
    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORBBBB')).toBeUndefined();
  });
});

describe('reads', () => {
  beforeEach(async () => {
    await persistNewRecoverySet(UID, builderFor('SELECTORAAAA'), NOW);
  });

  it('reads a set by selector', async () => {
    const set = await getRecoverySetById('SELECTORAAAA');

    expect(set?.recoverySetId).toBe('SELECTORAAAA');
    expect(set?.status).toBe('active');
  });

  it('returns null for an unknown selector', async () => {
    expect(await getRecoverySetById('NOPENOPENOPE')).toBeNull();
  });

  it('reads the pointer', async () => {
    expect((await getRecoveryPointer(UID))?.activeSetId).toBe('SELECTORAAAA');
    expect(await getRecoveryPointer('nobody')).toBeNull();
  });

  it('resolves the active set through the pointer', async () => {
    expect((await getActiveRecoverySetForUid(UID))?.recoverySetId).toBe('SELECTORAAAA');
  });

  it('reports no active set when the pointer is stale', async () => {
    // A pointer at a rotated set must never be reported as active.
    fake.current.seed(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA', {
      ...fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA'),
      status: 'rotated',
    });

    expect(await getActiveRecoverySetForUid(UID)).toBeNull();
  });

  it('reports no active set for a user who has none', async () => {
    expect(await getActiveRecoverySetForUid('nobody')).toBeNull();
  });
});
