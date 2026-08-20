import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * MFA Recovery — integration tests against the REAL Firestore Emulator.
 *
 * WHY THIS EXISTS ALONGSIDE THE FAKE
 * ----------------------------------
 * `__tests__/fakeFirestore.ts` proves specific INTERLEAVINGS: a competitor
 * committing in the exact window between another transaction's read and its
 * commit, a selector taken in that same window, a retry budget exhausted.
 * Those orderings are scheduled explicitly there, so they are deterministic.
 *
 * What the fake cannot prove is that the repository is talking to Firestore
 * correctly: that `Transaction.create` really carries a must-not-exist
 * precondition, that a real transaction really serializes two callers on the
 * pointer document, that `Timestamp` round-trips through the closed schema.
 * That is this file's job.
 *
 * Division of responsibility, stated so neither layer is mistaken for the
 * other:
 *
 *   fake      -> chosen interleavings, deterministic, no emulator
 *   emulator  -> real SDK/transaction semantics and end-state invariants
 *
 * Fine-grained abort/retry scheduling stays in the fake ON PURPOSE. Inducing a
 * specific transaction retry against the real emulator would mean racing the
 * scheduler, which produces a flaky test rather than a stronger one.
 *
 * SAFETY: this suite refuses to run unless FIRESTORE_EMULATOR_HOST is set. It
 * must never be able to touch a real project.
 */

import { parseRecoveryCode } from '../codeFormat';
import { RECOVERY_DIGEST_ALGORITHM, RECOVERY_DIGEST_BYTES } from '../digest';
import { provisionRecoverySet } from '../generateRecoveryCodes';
import { db } from '../../lib/firebaseAdmin';
import {
  RecoveryGenerationConflictError,
  RecoverySelectorTakenError,
  persistNewRecoverySet,
  readRecoveryPointerState,
} from '../recoverySetRepository';
import {
  MFA_RECOVERY_COLLECTION,
  MFA_RECOVERY_POINTER_COLLECTION,
  RECOVERY_CODES_PER_SET,
  RECOVERY_SCHEMA_VERSION,
  validateRecoverySet,
} from '../schema';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;

// Synchronous, module-level, and therefore evaluated before a single test is
// registered — nothing in this file can run against a real project. The
// imports above are safe to evaluate first: `initializeApp()` performs no I/O
// and writes nothing; only the test bodies below touch Firestore, and they
// cannot be reached past this guard.
if (!EMULATOR_HOST) {
  throw new Error(
    'FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:mfa-recovery:emulator` — ' +
      'these tests must never reach a real Firestore project.',
  );
}
if (!PROJECT_ID) {
  throw new Error('GCLOUD_PROJECT is not set; refusing to guess a project id.');
}

/** Test-only key. The real pepper is never provisioned or read here. */
const PEPPER = randomBytes(32);

let uidCounter = 0;
function freshUid(): string {
  uidCounter += 1;
  return `emulator-user-${uidCounter}`;
}

async function clearFirestore(): Promise<void> {
  const response = await fetch(
    `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    throw new Error(`Failed to clear the emulator: ${response.status}`);
  }
}

/** Everything currently stored, read straight from the emulator. */
async function readAllSets(): Promise<Record<string, unknown>[]> {
  const snapshot = await db.collection(MFA_RECOVERY_COLLECTION).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function readPointer(uid: string): Promise<Record<string, unknown> | undefined> {
  const snapshot = await db.collection(MFA_RECOVERY_POINTER_COLLECTION).doc(uid).get();
  return snapshot.data();
}

/**
 * The invariants that must hold after ANY sequence of operations, checked
 * against the database rather than against return values.
 */
async function assertInvariants(uid: string): Promise<Record<string, unknown> | null> {
  const sets = (await readAllSets()).filter((set) => set.uid === uid);
  const pointer = await readPointer(uid);

  const active = sets.filter((set) => set.status === 'active');
  expect(active.length, 'at most one active set').toBeLessThanOrEqual(1);

  for (const set of sets) {
    // No set may sit in a state outside the declared machine.
    expect(['active', 'rotated', 'exhausted']).toContain(set.status);
    // Nothing partially written: every persisted set satisfies the closed
    // schema after Timestamp hydration.
    expect(validateRecoverySet(hydrate(set))).toEqual([]);
  }

  if (pointer) {
    if (pointer.activeSetId) {
      const target = sets.find((set) => set.id === pointer.activeSetId);
      // The pointer never names a set that does not exist.
      expect(target, 'pointer names an existing set').toBeDefined();
      expect(target?.status, 'pointer names the active set').toBe('active');
      expect(pointer.version, 'pointer.version matches the active set').toBe(target?.version);
    }
  }

  // No plaintext, anywhere.
  const serialized = JSON.stringify(sets);
  expect(serialized).not.toContain('AJF');
  for (const forbidden of ['plaintext', 'plainCode', 'rawCode', 'recoveryCode']) {
    expect(serialized).not.toContain(forbidden);
  }

  return active[0] ?? null;
}

/** Firestore returns Timestamps; the closed schema expects Dates. */
function hydrate(raw: Record<string, unknown>): Record<string, unknown> {
  const toDate = (value: unknown) =>
    value && typeof (value as { toDate?: unknown }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : value;

  const { id: _id, ...set } = raw;
  return {
    ...set,
    createdAt: toDate(set.createdAt),
    rotatedAt: toDate(set.rotatedAt),
    codes: (set.codes as Record<string, unknown>[]).map((code) => ({
      ...code,
      createdAt: toDate(code.createdAt),
      reservedAt: toDate(code.reservedAt),
      consumedAt: toDate(code.consumedAt),
    })),
    rateLimit: {
      ...(set.rateLimit as Record<string, unknown>),
      windowStartedAt: toDate((set.rateLimit as Record<string, unknown>).windowStartedAt),
      lastAttemptAt: toDate((set.rateLimit as Record<string, unknown>).lastAttemptAt),
      blockedUntil: toDate((set.rateLimit as Record<string, unknown>).blockedUntil),
    },
  };
}

beforeAll(async () => {
  await clearFirestore();
});

afterAll(async () => {
  await clearFirestore();
});

beforeEach(async () => {
  await clearFirestore();
});

describe('emulator — creation', () => {
  it('writes the set and the pointer, with digests only', async () => {
    const uid = freshUid();
    const { recoverySetId, codes } = await provisionRecoverySet(uid, PEPPER, new Date());

    const stored = await db.collection(MFA_RECOVERY_COLLECTION).doc(recoverySetId).get();
    expect(stored.exists, '_mfaRecovery/{id} exists').toBe(true);

    const set = stored.data()!;
    expect(set.uid).toBe(uid);
    expect(set.status).toBe('active');
    expect(set.version).toBe(1);
    expect(set.schemaVersion).toBe(RECOVERY_SCHEMA_VERSION);
    expect(set.pepperVersion).toBe(1);
    expect(set.digestAlgorithm).toBe(RECOVERY_DIGEST_ALGORITHM);

    const pointer = await readPointer(uid);
    expect(pointer, '_mfaRecoveryUsers/{uid} exists').toBeDefined();
    expect(pointer?.activeSetId).toBe(recoverySetId);
    expect(pointer?.version).toBe(1);

    expect(codes).toHaveLength(RECOVERY_CODES_PER_SET);
    await assertInvariants(uid);
  });

  it('stores exactly ten available code records', async () => {
    const uid = freshUid();
    const { recoverySetId } = await provisionRecoverySet(uid, PEPPER, new Date());

    const set = (await db.collection(MFA_RECOVERY_COLLECTION).doc(recoverySetId).get()).data()!;
    const records = set.codes as Record<string, unknown>[];

    expect(records).toHaveLength(RECOVERY_CODES_PER_SET);
    for (const record of records) {
      expect(record.state).toBe('available');
      expect(record.operationId).toBeNull();
      expect(record.consumedAt).toBeNull();
      expect(Buffer.from(record.digest as string, 'base64')).toHaveLength(RECOVERY_DIGEST_BYTES);
    }
  });

  it('stores no duplicate digests', async () => {
    const uid = freshUid();
    const { recoverySetId } = await provisionRecoverySet(uid, PEPPER, new Date());

    const set = (await db.collection(MFA_RECOVERY_COLLECTION).doc(recoverySetId).get()).data()!;
    const digests = (set.codes as { digest: string }[]).map((code) => code.digest);

    expect(new Set(digests).size).toBe(RECOVERY_CODES_PER_SET);
  });

  it('persists neither the plaintext codes nor the pepper', async () => {
    const uid = freshUid();
    const { recoverySetId, codes } = await provisionRecoverySet(uid, PEPPER, new Date());

    const raw = JSON.stringify(
      (await db.collection(MFA_RECOVERY_COLLECTION).doc(recoverySetId).get()).data(),
    );

    for (const code of codes) {
      expect(raw).not.toContain(code);
      expect(raw).not.toContain(parseRecoveryCode(code).secret);
    }
    expect(raw).not.toContain('AJF');
    expect(raw).not.toContain(PEPPER.toString('base64'));
  });

  it('names the set with the selector every returned code carries', async () => {
    const uid = freshUid();
    const { recoverySetId, codes } = await provisionRecoverySet(uid, PEPPER, new Date());

    for (const code of codes) {
      expect(parseRecoveryCode(code).selector).toBe(recoverySetId);
    }
  });
});

describe('emulator — rotation', () => {
  it('rotates the previous set and repoints, leaving exactly one active', async () => {
    const uid = freshUid();
    const first = await provisionRecoverySet(uid, PEPPER, new Date());
    const second = await provisionRecoverySet(uid, PEPPER, new Date());

    expect(second.recoverySetId).not.toBe(first.recoverySetId);

    const previous = (
      await db.collection(MFA_RECOVERY_COLLECTION).doc(first.recoverySetId).get()
    ).data()!;
    expect(previous.status).toBe('rotated');
    expect(previous.rotatedAt).toBeDefined();

    const current = (
      await db.collection(MFA_RECOVERY_COLLECTION).doc(second.recoverySetId).get()
    ).data()!;
    expect(current.status).toBe('active');
    expect(current.version).toBe(2);

    const pointer = await readPointer(uid);
    expect(pointer?.activeSetId).toBe(second.recoverySetId);
    expect(pointer?.version).toBe(2);

    const active = await assertInvariants(uid);
    expect(active?.id).toBe(second.recoverySetId);
  });

  it('keeps invariants across several sequential regenerations', async () => {
    const uid = freshUid();
    const ids: string[] = [];

    for (let round = 0; round < 4; round += 1) {
      const { recoverySetId } = await provisionRecoverySet(uid, PEPPER, new Date());
      ids.push(recoverySetId);
      await assertInvariants(uid);
    }

    const sets = (await readAllSets()).filter((set) => set.uid === uid);
    expect(sets).toHaveLength(4);
    expect(sets.filter((set) => set.status === 'active')).toHaveLength(1);

    const pointer = await readPointer(uid);
    expect(pointer?.activeSetId).toBe(ids.at(-1));
    expect(pointer?.version).toBe(4);
  });
});

describe('emulator — concurrent generation', () => {
  it('lets exactly one of two simultaneous generations issue codes', async () => {
    const uid = freshUid();

    const results = await Promise.allSettled([
      provisionRecoverySet(uid, PEPPER, new Date()),
      provisionRecoverySet(uid, PEPPER, new Date()),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled, 'exactly one winner').toHaveLength(1);
    expect(rejected, 'exactly one loser').toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      RecoveryGenerationConflictError,
    );

    // The winner's codes are the ones that survive: the set it returned is
    // the active one, not a rotated leftover.
    const winner = (
      fulfilled[0] as PromiseFulfilledResult<{ recoverySetId: string; codes: string[] }>
    ).value;
    const active = await assertInvariants(uid);
    expect(active?.id).toBe(winner.recoverySetId);

    // The loser wrote nothing at all.
    const sets = (await readAllSets()).filter((set) => set.uid === uid);
    expect(sets).toHaveLength(1);
  });

  it('holds under repeated concurrent rounds', async () => {
    // Repeated rather than timed: the assertions are on the FINAL state, so
    // whichever caller wins, the invariants are identical. Nothing here
    // depends on scheduling order.
    for (let round = 0; round < 5; round += 1) {
      const uid = freshUid();

      const results = await Promise.allSettled([
        provisionRecoverySet(uid, PEPPER, new Date()),
        provisionRecoverySet(uid, PEPPER, new Date()),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const active = await assertInvariants(uid);
      expect(active).not.toBeNull();

      const sets = (await readAllSets()).filter((set) => set.uid === uid);
      expect(sets, 'the loser persisted nothing').toHaveLength(1);
    }
  });

  it('survives three-way contention with a single winner', async () => {
    const uid = freshUid();

    const results = await Promise.allSettled([
      provisionRecoverySet(uid, PEPPER, new Date()),
      provisionRecoverySet(uid, PEPPER, new Date()),
      provisionRecoverySet(uid, PEPPER, new Date()),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const rejection of results.filter((r) => r.status === 'rejected')) {
      expect((rejection as PromiseRejectedResult).reason).toBeInstanceOf(
        RecoveryGenerationConflictError,
      );
    }

    await assertInvariants(uid);
    expect((await readAllSets()).filter((set) => set.uid === uid)).toHaveLength(1);
  });

  it('does not let one user\'s generation interfere with another\'s', async () => {
    const [uidA, uidB] = [freshUid(), freshUid()];

    const results = await Promise.allSettled([
      provisionRecoverySet(uidA, PEPPER, new Date()),
      provisionRecoverySet(uidB, PEPPER, new Date()),
    ]);

    // Different pointer documents — no contention, both succeed.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    await assertInvariants(uidA);
    await assertInvariants(uidB);
  });
});

describe('emulator — stale operation fencing', () => {
  it('refuses a commit whose expected version is behind', async () => {
    const uid = freshUid();
    const stale = (await readRecoveryPointerState(uid)).version;

    await provisionRecoverySet(uid, PEPPER, new Date());
    await provisionRecoverySet(uid, PEPPER, new Date());

    // An operation that read the pointer before either generation and only
    // now tries to commit must not overwrite the newer set.
    await expect(
      persistNewRecoverySet(uid, stale, ({ version }) => buildSetFor(uid, 'STALESETXXXX', version), new Date()),
    ).rejects.toBeInstanceOf(RecoveryGenerationConflictError);

    const pointer = await readPointer(uid);
    expect(pointer?.version).toBe(2);
    expect(pointer?.activeSetId).not.toBe('STALESETXXXX');
    await assertInvariants(uid);
  });
});

describe('emulator — selector collision', () => {
  it('fails the create and leaves the existing document untouched', async () => {
    const uid = freshUid();
    const taken = 'TAKENSELECTR';

    const sentinel = { uid: 'someone-else', status: 'active', sentinel: 'untouched' };
    await db.collection(MFA_RECOVERY_COLLECTION).doc(taken).set(sentinel);

    await expect(
      persistNewRecoverySet(uid, 0, ({ version }) => buildSetFor(uid, taken, version), new Date()),
    ).rejects.toBeInstanceOf(RecoverySelectorTakenError);

    // Byte-for-byte intact — `create`'s precondition really did hold.
    expect((await db.collection(MFA_RECOVERY_COLLECTION).doc(taken).get()).data()).toEqual(
      sentinel,
    );
    // And the loser never got a pointer.
    expect(await readPointer(uid)).toBeUndefined();
  });

  it('completes with a different selector after a collision', async () => {
    const uid = freshUid();
    const taken = 'TAKENSELECTR';
    await db.collection(MFA_RECOVERY_COLLECTION).doc(taken).set({ status: 'active' });

    await expect(
      persistNewRecoverySet(uid, 0, ({ version }) => buildSetFor(uid, taken, version), new Date()),
    ).rejects.toBeInstanceOf(RecoverySelectorTakenError);

    // The orchestrator's response to that is a fresh selector; here we take
    // the same step by hand to prove the second attempt lands cleanly.
    const result = await persistNewRecoverySet(
      uid,
      0,
      ({ version }) => buildSetFor(uid, 'FRESHSELECTR', version),
      new Date(),
    );

    expect(result.recoverySetId).toBe('FRESHSELECTR');
    expect((await readPointer(uid))?.activeSetId).toBe('FRESHSELECTR');
    expect((await db.collection(MFA_RECOVERY_COLLECTION).doc(taken).get()).data()).toEqual({
      status: 'active',
    });
  });
});

/** Minimal schema-valid set, for repository-level tests that pick the selector. */
function buildSetFor(uid: string, recoverySetId: string, version: number) {
  const now = new Date();
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    recoverySetId,
    uid,
    version,
    pepperVersion: 1,
    digestVersion: 1,
    digestAlgorithm: RECOVERY_DIGEST_ALGORITHM,
    status: 'active' as const,
    createdAt: now,
    rotatedAt: null,
    codes: [1, 2, 3].map((index) => ({
      id: `code-${index}`,
      digest: Buffer.alloc(RECOVERY_DIGEST_BYTES, index).toString('base64'),
      state: 'available' as const,
      createdAt: now,
      reservedAt: null,
      consumedAt: null,
      operationId: null,
    })),
    rateLimit: {
      attempts: 0,
      windowStartedAt: null,
      lastAttemptAt: null,
      blockedUntil: null,
    },
    activeOperation: null,
  };
}
