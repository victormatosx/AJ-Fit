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
  NO_RECOVERY_POINTER_VERSION,
  RecoveryGenerationConflictError,
  RecoverySelectorTakenError,
  getActiveRecoverySetForUid,
  getRecoveryPointer,
  getRecoverySetById,
  persistNewRecoverySet,
  readRecoveryPointerState,
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

/** Calls the repository the way the handler does: read version, then commit. */
function persist(recoverySetId: string, expectedVersion: number, now: Date = NOW) {
  return persistNewRecoverySet(
    UID,
    expectedVersion,
    ({ version }) => buildSet(recoverySetId, version),
    now,
  );
}

function activeSets(): string[] {
  return [...fake.current.store.entries()]
    .filter(
      ([key, value]: [string, { data: Record<string, unknown> }]) =>
        key.startsWith(`${MFA_RECOVERY_COLLECTION}/`) && value.data.status === 'active',
    )
    .map(([key]: [string, unknown]) => key.replace(`${MFA_RECOVERY_COLLECTION}/`, ''));
}

beforeEach(() => {
  fake.current = createFakeFirestore();
});

describe('pointer state — the compare-and-set token', () => {
  it('reports version 0 for a user who has never generated', async () => {
    expect(await readRecoveryPointerState(UID)).toEqual({
      activeSetId: null,
      version: NO_RECOVERY_POINTER_VERSION,
    });
    expect(NO_RECOVERY_POINTER_VERSION).toBe(0);
  });

  it('reports the current version and active set after a generation', async () => {
    await persist('SELECTORAAAA', 0);

    expect(await readRecoveryPointerState(UID)).toEqual({
      activeSetId: 'SELECTORAAAA',
      version: 1,
    });
  });
});

describe('persistNewRecoverySet — first set for a user', () => {
  it('creates the set and points the user at it', async () => {
    const result = await persist('SELECTORAAAA', 0);

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
    expect(pointer?.version).toBe(1);
  });

  it('keeps pointer.version in lockstep with the active set version', async () => {
    await persist('SELECTORAAAA', 0);

    const pointer = fake.current.read(MFA_RECOVERY_POINTER_COLLECTION, UID);
    const set = fake.current.read(MFA_RECOVERY_COLLECTION, pointer?.activeSetId as string);

    expect(pointer?.version).toBe(set?.version);
  });

  it('persists no plaintext recovery code', async () => {
    await persist('SELECTORAAAA', 0);

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
        0,
        ({ version }) => ({ ...buildSet('SELECTORAAAA', version), status: 'bogus' }) as never,
        NOW,
      ),
    ).rejects.toThrow(/Invalid recovery set/);

    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA')).toBeUndefined();
  });
});

describe('persistNewRecoverySet — sequential rotation', () => {
  beforeEach(async () => {
    await persist('SELECTORAAAA', 0);
  });

  it('moves the previous set to rotated and repoints', async () => {
    const later = new Date('2026-08-19T11:00:00Z');
    const result = await persist('SELECTORBBBB', 1, later);

    expect(result.rotatedSetId).toBe('SELECTORAAAA');
    expect(result.version).toBe(2);

    const previous = fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA');
    expect(previous?.status).toBe('rotated');
    expect(previous?.rotatedAt).toEqual(later);

    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORBBBB')?.status).toBe('active');
    expect(fake.current.read(MFA_RECOVERY_POINTER_COLLECTION, UID)).toMatchObject({
      activeSetId: 'SELECTORBBBB',
      version: 2,
    });
  });

  it('leaves exactly one active set', async () => {
    await persist('SELECTORBBBB', 1);
    await persist('SELECTORCCCC', 2);

    expect(activeSets()).toEqual(['SELECTORCCCC']);
  });

  it('increments the version across rotations', async () => {
    expect((await persist('SELECTORBBBB', 1)).version).toBe(2);
    expect((await persist('SELECTORCCCC', 2)).version).toBe(3);
  });

  it('repairs a stale pointer that names an already-rotated set', async () => {
    // Simulates a rotation interrupted after the set moved but before the
    // pointer did: the pointer is rebuilt, and nothing is rotated twice.
    fake.current.seed(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA', {
      ...fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA'),
      status: 'rotated',
      rotatedAt: NOW,
    });

    const result = await persist('SELECTORBBBB', 1);

    expect(result.rotatedSetId).toBeNull();
    expect(fake.current.read(MFA_RECOVERY_POINTER_COLLECTION, UID)?.activeSetId).toBe(
      'SELECTORBBBB',
    );
  });

  it('tolerates a pointer naming a set that no longer exists', async () => {
    fake.current.store.delete(`${MFA_RECOVERY_COLLECTION}/SELECTORAAAA`);

    const result = await persist('SELECTORBBBB', 1);

    expect(result.rotatedSetId).toBeNull();
    expect(result.recoverySetId).toBe('SELECTORBBBB');
  });
});

describe('compare-and-set — the concurrency guard', () => {
  it('refuses to commit against a stale expected version', async () => {
    await persist('SELECTORAAAA', 0);

    // A generation that read version 0 before the winner committed.
    await expect(persist('SELECTORBBBB', 0)).rejects.toBeInstanceOf(
      RecoveryGenerationConflictError,
    );
  });

  it('writes absolutely nothing when it conflicts', async () => {
    await persist('SELECTORAAAA', 0);

    await expect(persist('SELECTORBBBB', 0)).rejects.toThrow();

    // The loser's set was never created...
    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORBBBB')).toBeUndefined();
    // ...and the winner was neither rotated nor repointed.
    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA')?.status).toBe('active');
    expect(fake.current.read(MFA_RECOVERY_POINTER_COLLECTION, UID)).toMatchObject({
      activeSetId: 'SELECTORAAAA',
      version: 1,
    });
  });

  it('rejects a generation that started before ANY set existed, once one exists', async () => {
    const staleVersion = (await readRecoveryPointerState(UID)).version;
    await persist('SELECTORAAAA', 0);

    await expect(persist('SELECTORBBBB', staleVersion)).rejects.toBeInstanceOf(
      RecoveryGenerationConflictError,
    );
  });

  it('fences a stale operation that resumes long after a newer set won', async () => {
    // The critical case: an old, slow attempt must never commit over a newer
    // set. Two rotations happen while it is away; its expected version is now
    // two generations behind.
    await persist('SELECTORAAAA', 0);
    await persist('SELECTORBBBB', 1);

    await expect(persist('SELECTORLATE', 0)).rejects.toBeInstanceOf(
      RecoveryGenerationConflictError,
    );
    expect(activeSets()).toEqual(['SELECTORBBBB']);
  });

  it('conflicts when a competitor commits between our read and our commit', async () => {
    // The genuine interleaving: our transaction reads version 0, a competitor
    // commits version 1, and our commit is aborted-and-retried by Firestore.
    // The retry re-reads version 1, sees it no longer matches what we
    // generated against, and refuses — instead of rotating the competitor.
    fake.current = createFakeFirestore({
      onBeforeCommit: (attempt: number, store: Map<string, unknown>) => {
        if (attempt === 1) {
          store.set(`${MFA_RECOVERY_COLLECTION}/SELECTORZZZZ`, {
            data: buildSet('SELECTORZZZZ', 1),
            version: 1,
          });
          store.set(`${MFA_RECOVERY_POINTER_COLLECTION}/${UID}`, {
            data: {
              schemaVersion: 1,
              uid: UID,
              activeSetId: 'SELECTORZZZZ',
              version: 1,
              updatedAt: NOW,
            },
            version: 1,
          });
        }
      },
    });

    await expect(persist('SELECTORBBBB', 0)).rejects.toBeInstanceOf(
      RecoveryGenerationConflictError,
    );

    // The competitor keeps its freshly-issued codes: still active, never
    // rotated by the loser.
    expect(activeSets()).toEqual(['SELECTORZZZZ']);
    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORBBBB')).toBeUndefined();
  });

  it('lets a sequential regeneration through once it reads the new version', async () => {
    await persist('SELECTORAAAA', 0);

    // The losing caller retries properly: re-reads, then commits.
    const { version } = await readRecoveryPointerState(UID);
    const result = await persist('SELECTORBBBB', version);

    expect(result.rotatedSetId).toBe('SELECTORAAAA');
    expect(activeSets()).toEqual(['SELECTORBBBB']);
  });
});

describe('persistNewRecoverySet — selector collision', () => {
  it('never overwrites an existing set', async () => {
    fake.current.seed(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA', {
      uid: 'someone-else',
      status: 'active',
      sentinel: 'untouched',
    });

    await expect(persist('SELECTORAAAA', 0)).rejects.toBeInstanceOf(RecoverySelectorTakenError);

    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA')).toEqual({
      uid: 'someone-else',
      status: 'active',
      sentinel: 'untouched',
    });
  });

  it('does not repoint the user when the create fails', async () => {
    fake.current.seed(MFA_RECOVERY_COLLECTION, 'SELECTORAAAA', { status: 'active' });

    await expect(persist('SELECTORAAAA', 0)).rejects.toThrow();

    expect(fake.current.read(MFA_RECOVERY_POINTER_COLLECTION, UID)).toBeUndefined();
  });

  it('surfaces a collision created mid-transaction', async () => {
    fake.current = createFakeFirestore({
      onBeforeCommit: (attempt: number, store: Map<string, unknown>) => {
        if (attempt === 1) {
          store.set(`${MFA_RECOVERY_COLLECTION}/SELECTORAAAA`, {
            data: { status: 'active', uid: 'racer' },
            version: 1,
          });
        }
      },
    });

    await expect(persist('SELECTORAAAA', 0)).rejects.toBeInstanceOf(RecoverySelectorTakenError);
  });
});

describe('persistNewRecoverySet — infrastructure failure', () => {
  it('never leaves a partially written state when the transaction aborts', async () => {
    fake.current = createFakeFirestore({
      maxAttempts: 3,
      onBeforeCommit: (attempt: number, store: Map<string, unknown>) => {
        // A writer that keeps touching an unrelated field of the pointer, so
        // every attempt is stale on the READ version without changing the CAS
        // version — exhausting the retry budget.
        store.set(`${MFA_RECOVERY_POINTER_COLLECTION}/${UID}`, {
          data: { schemaVersion: 1, uid: UID, activeSetId: null, version: 0, updatedAt: NOW },
          version: 100 + attempt,
        });
      },
    });

    await expect(persist('SELECTORBBBB', 0)).rejects.toThrow();

    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORBBBB')).toBeUndefined();
  });

  it('propagates an infrastructure failure without writing anything', async () => {
    fake.current.db.runTransaction = async () => {
      throw new Error('FIRESTORE_UNAVAILABLE');
    };

    await expect(persist('SELECTORBBBB', 0)).rejects.toThrow('FIRESTORE_UNAVAILABLE');
    expect(fake.current.read(MFA_RECOVERY_COLLECTION, 'SELECTORBBBB')).toBeUndefined();
  });
});

describe('reads', () => {
  beforeEach(async () => {
    await persist('SELECTORAAAA', 0);
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
