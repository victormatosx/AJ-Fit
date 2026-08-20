import { db } from '../lib/firebaseAdmin';
import {
  MFA_RECOVERY_COLLECTION,
  MFA_RECOVERY_POINTER_COLLECTION,
  RECOVERY_SCHEMA_VERSION,
  type RecoveryPointerDocument,
  type RecoverySetDocument,
  assertValidRecoveryPointer,
  assertValidRecoverySet,
} from './schema';
import { assertRecoverySetTransition } from './stateMachine';

/**
 * MFA Recovery — Firestore access for the backend-only recovery collections.
 *
 * Paths:
 *   _mfaRecovery/{recoverySetId}   the sets themselves (digests only)
 *   _mfaRecoveryUsers/{uid}        pointer to the one active set
 *
 * Both are denied to every client by Security Rules; the Admin SDK used here
 * bypasses those rules, which is exactly why every write goes through
 * `assertValidRecoverySet` / `assertValidRecoveryPointer` first — this module
 * is the only place the closed schemas are actually enforced.
 *
 * The uid is always supplied by the caller from `request.auth.uid`. Nothing
 * here reads a path, a uid or a document id from client input.
 *
 * PHASE 2 SCOPE: create, read and rotate. There is deliberately no update
 * path for `codes`, `rateLimit` or `activeOperation` — consuming a code is
 * Phase 4, and shipping a mutator before the flow that needs it would be an
 * unused, untested hole in a security surface.
 */

/** gRPC status code for ALREADY_EXISTS, returned by `create()` on collision. */
const FIRESTORE_ALREADY_EXISTS = 6;

/**
 * Raised when the generated selector already names a document.
 *
 * Astronomically unlikely at 60 bits (see codeFormat.ts) — this exists so the
 * caller can mint a NEW selector and retry rather than ever overwriting
 * somebody's live recovery set.
 */
export class RecoverySelectorTakenError extends Error {
  constructor() {
    super('RECOVERY_SELECTOR_TAKEN');
    this.name = 'RecoverySelectorTakenError';
  }
}

/**
 * Raised when the pointer moved between the moment a generation read it and
 * the moment it tried to commit — i.e. a concurrent generation won.
 *
 * This error is the whole point of the compare-and-set: the losing call must
 * fail BEFORE returning anything, because the alternative (committing anyway
 * and rotating the winner) hands a user recovery codes that are already dead.
 * Nothing is written when this is thrown.
 */
export class RecoveryGenerationConflictError extends Error {
  constructor() {
    super('RECOVERY_GENERATION_CONFLICT');
    this.name = 'RecoveryGenerationConflictError';
  }
}

function setRef(recoverySetId: string) {
  return db.collection(MFA_RECOVERY_COLLECTION).doc(recoverySetId);
}

function pointerRef(uid: string) {
  return db.collection(MFA_RECOVERY_POINTER_COLLECTION).doc(uid);
}

function isAlreadyExists(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === FIRESTORE_ALREADY_EXISTS
  );
}

/**
 * Firestore hands timestamps back as `Timestamp`, not `Date`. Normalize
 * before validating so a stored document is checked against the same closed
 * schema that gated the write.
 */
function toDate(value: unknown): unknown {
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return value;
}

function hydrateSet(data: Record<string, unknown>): RecoverySetDocument {
  const codes = Array.isArray(data.codes) ? data.codes : [];

  return {
    ...data,
    createdAt: toDate(data.createdAt),
    rotatedAt: toDate(data.rotatedAt),
    codes: codes.map((code) => {
      const record = code as Record<string, unknown>;
      return {
        ...record,
        createdAt: toDate(record.createdAt),
        reservedAt: toDate(record.reservedAt),
        consumedAt: toDate(record.consumedAt),
      };
    }),
    rateLimit: {
      ...(data.rateLimit as Record<string, unknown>),
      windowStartedAt: toDate((data.rateLimit as Record<string, unknown>)?.windowStartedAt),
      lastAttemptAt: toDate((data.rateLimit as Record<string, unknown>)?.lastAttemptAt),
      blockedUntil: toDate((data.rateLimit as Record<string, unknown>)?.blockedUntil),
    },
    activeOperation: data.activeOperation
      ? {
          ...(data.activeOperation as Record<string, unknown>),
          createdAt: toDate((data.activeOperation as Record<string, unknown>).createdAt),
          updatedAt: toDate((data.activeOperation as Record<string, unknown>).updatedAt),
        }
      : null,
  } as RecoverySetDocument;
}

/** Reads a recovery set by its selector, or null when none exists. */
export async function getRecoverySetById(
  recoverySetId: string,
): Promise<RecoverySetDocument | null> {
  const snapshot = await setRef(recoverySetId).get();
  const data = snapshot.data();

  return snapshot.exists && data ? hydrateSet(data) : null;
}

/** Reads the pointer document for a uid, or null when the user has none. */
export async function getRecoveryPointer(
  uid: string,
): Promise<RecoveryPointerDocument | null> {
  const snapshot = await pointerRef(uid).get();
  const data = snapshot.data();

  if (!snapshot.exists || !data) {
    return null;
  }

  return { ...data, updatedAt: toDate(data.updatedAt) } as RecoveryPointerDocument;
}

/** Version carried by a uid with no pointer yet. The first write makes it 1. */
export const NO_RECOVERY_POINTER_VERSION = 0;

export interface RecoveryPointerState {
  activeSetId: string | null;
  /** Compare-and-set token to hand back to `persistNewRecoverySet`. */
  version: number;
}

/**
 * Reads the compare-and-set token a generation must commit against.
 *
 * Called BEFORE any code is minted. The value captured here is what makes a
 * concurrent generation detectable: if it changed by commit time, someone
 * else generated in the meantime and this attempt must abandon its codes.
 */
export async function readRecoveryPointerState(uid: string): Promise<RecoveryPointerState> {
  const pointer = await getRecoveryPointer(uid);

  return {
    activeSetId: pointer?.activeSetId ?? null,
    version: pointer?.version ?? NO_RECOVERY_POINTER_VERSION,
  };
}

/**
 * Reads the uid's active recovery set via the pointer.
 *
 * Returns null both when there is no pointer and when the pointer names a set
 * that is no longer `active` — a stale pointer must never be reported as an
 * active set.
 */
export async function getActiveRecoverySetForUid(
  uid: string,
): Promise<RecoverySetDocument | null> {
  const pointer = await getRecoveryPointer(uid);
  if (!pointer?.activeSetId) {
    return null;
  }

  const set = await getRecoverySetById(pointer.activeSetId);
  return set && set.status === 'active' ? set : null;
}

export interface PersistRecoverySetResult {
  /** Selector of the set that is now active. */
  recoverySetId: string;
  /** Selector of the set this replaced, when there was one. */
  rotatedSetId: string | null;
  /** Rotation generation of the new set. 1 for a user's first set. */
  version: number;
}

/**
 * Atomically installs a new recovery set as the uid's active one, but ONLY if
 * no other generation has happened since `expectedVersion` was read.
 *
 * In ONE transaction:
 *   1. read the pointer, and the set it names (all reads first — Firestore
 *      forbids a read after a write inside a transaction);
 *   2. COMPARE-AND-SET: abort unless the pointer is still at
 *      `expectedVersion`;
 *   3. `create` the new set, which fails if the selector is taken;
 *   4. move the previous active set to `rotated`;
 *   5. repoint `_mfaRecoveryUsers/{uid}` at the new set, at
 *      `expectedVersion + 1`.
 *
 * WHY THE COMPARE-AND-SET, AND NOT JUST "LAST WRITER WINS"
 * -------------------------------------------------------
 * The pointer is a single document, so Firestore already serializes
 * concurrent generations and already guarantees exactly one active set. What
 * it does NOT prevent is both callers SUCCEEDING: the loser's transaction
 * retries, sees the winner's set, rotates it, and returns its own codes — so
 * two users' worth of plaintext goes out the door and one of those sets is
 * already dead. The caller has no way to know which.
 *
 * `expectedVersion` closes that. It is read BEFORE any code is minted, so a
 * generation that started from a now-stale view fails here, having written
 * nothing and having returned nothing. One winner; everyone else conflicts.
 *
 * This is also the stale-operation fence. A slow, retried or replayed attempt
 * carries an expected version that no longer matches, so it can never commit
 * over a newer set — no lock, no lease and therefore no orphaned lock to time
 * out and reclaim.
 *
 * `version` increments across rotations so the history of a user's sets is
 * ordered even though each one lives under an unrelated random selector, and
 * it always matches the `version` of the set the pointer names.
 */
export async function persistNewRecoverySet(
  uid: string,
  expectedVersion: number,
  buildSet: (input: { version: number }) => RecoverySetDocument,
  now: Date,
): Promise<PersistRecoverySetResult> {
  try {
    return await db.runTransaction(async (transaction) => {
      // ---- reads ----------------------------------------------------------
      const pointerSnapshot = await transaction.get(pointerRef(uid));
      const pointerData = pointerSnapshot.data();
      const currentVersion =
        (pointerData?.version as number | undefined) ?? NO_RECOVERY_POINTER_VERSION;

      // ---- compare-and-set -------------------------------------------------
      // Thrown, not returned: a user-thrown error is not a contention abort,
      // so Firestore propagates it instead of retrying the callback. Retrying
      // is exactly what must NOT happen — a retry would re-read the winner's
      // version and then succeed, which is the bug this guard exists to stop.
      if (currentVersion !== expectedVersion) {
        throw new RecoveryGenerationConflictError();
      }

      const previousSetId = (pointerData?.activeSetId as string | undefined) ?? null;

      const previousSnapshot = previousSetId
        ? await transaction.get(setRef(previousSetId))
        : null;

      const previousStatus = previousSnapshot?.data()?.status as string | undefined;

      // A pointer at a set that is not active is stale, not a conflict: it
      // just means the last rotation was interrupted after the set moved but
      // before the pointer did. Rebuilding the pointer here repairs it.
      const shouldRotatePrevious = previousSnapshot?.exists && previousStatus === 'active';

      // Derived from the pointer, not from the previous set document: the
      // pointer is the authority on how many generations this uid has had,
      // and keeping the two in lockstep makes `pointer.version ===
      // activeSet.version` an invariant the tests can assert.
      const nextVersion = expectedVersion + 1;

      const document = buildSet({ version: nextVersion });
      assertValidRecoverySet(document);

      const pointer: RecoveryPointerDocument = {
        schemaVersion: RECOVERY_SCHEMA_VERSION,
        uid,
        activeSetId: document.recoverySetId,
        version: nextVersion,
        updatedAt: now,
      };
      assertValidRecoveryPointer(pointer);

      // ---- writes ---------------------------------------------------------
      // `create` carries a server-side must-not-exist precondition, so a
      // selector collision can never silently overwrite a live set.
      transaction.create(setRef(document.recoverySetId), document);

      if (shouldRotatePrevious && previousSetId) {
        // Checked against the declared machine rather than assumed: this is
        // the only place a set leaves `active`.
        assertRecoverySetTransition('active', 'rotated');
        transaction.update(setRef(previousSetId), { status: 'rotated', rotatedAt: now });
      }

      transaction.set(pointerRef(uid), pointer);

      return {
        recoverySetId: document.recoverySetId,
        rotatedSetId: shouldRotatePrevious ? previousSetId : null,
        version: document.version,
      };
    });
  } catch (err) {
    if (isAlreadyExists(err)) {
      // Surfaced as a typed error so the caller mints a new selector and
      // retries. Firestore will not retry this itself — ALREADY_EXISTS is a
      // permanent failure for that write, not contention.
      throw new RecoverySelectorTakenError();
    }
    throw err;
  }
}
