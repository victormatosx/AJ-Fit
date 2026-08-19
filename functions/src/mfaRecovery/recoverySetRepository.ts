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
 * Atomically installs a new recovery set as the uid's active one.
 *
 * In ONE transaction:
 *   1. read the pointer, and the set it names (all reads first — Firestore
 *      forbids a read after a write inside a transaction);
 *   2. `create` the new set, which fails if the selector is taken;
 *   3. move the previous active set to `rotated`;
 *   4. repoint `_mfaRecoveryUsers/{uid}` at the new set.
 *
 * WHY THIS CANNOT LEAVE TWO ACTIVE SETS
 * -------------------------------------
 * Every path that makes a set active also writes the pointer, and the pointer
 * is a single document. Two concurrent generations for one uid therefore
 * contend on the same key: Firestore aborts and retries the loser, whose
 * retry re-reads the pointer, sees the winner's set, and rotates IT. The
 * outcome is always exactly one active set — never two, never zero.
 *
 * The observable consequence, stated explicitly because it is a real
 * behaviour and not an accident: BOTH callers get a successful response with
 * different codes, but only the set written by the transaction that committed
 * LAST remains active. The earlier caller's codes are already `rotated` and
 * will not work. Callers must not race themselves; the Phase 3 client is
 * responsible for not issuing a second generation while one is in flight.
 *
 * `version` increments across rotations so the history of a user's sets is
 * ordered even though each one lives under an unrelated random selector.
 */
export async function persistNewRecoverySet(
  uid: string,
  buildSet: (input: { version: number }) => RecoverySetDocument,
  now: Date,
): Promise<PersistRecoverySetResult> {
  try {
    return await db.runTransaction(async (transaction) => {
      // ---- reads ----------------------------------------------------------
      const pointerSnapshot = await transaction.get(pointerRef(uid));
      const previousSetId =
        (pointerSnapshot.data()?.activeSetId as string | undefined) ?? null;

      const previousSnapshot = previousSetId
        ? await transaction.get(setRef(previousSetId))
        : null;

      const previousStatus = previousSnapshot?.data()?.status as string | undefined;
      const previousVersion = previousSnapshot?.data()?.version as number | undefined;

      // A pointer at a set that is not active is stale, not a conflict: it
      // just means the last rotation was interrupted after the set moved but
      // before the pointer did. Rebuilding the pointer here repairs it.
      const shouldRotatePrevious = previousSnapshot?.exists && previousStatus === 'active';

      const document = buildSet({ version: (previousVersion ?? 0) + 1 });
      assertValidRecoverySet(document);

      const pointer: RecoveryPointerDocument = {
        schemaVersion: RECOVERY_SCHEMA_VERSION,
        uid,
        activeSetId: document.recoverySetId,
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
