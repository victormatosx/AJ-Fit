/**
 * Firestore-backed persistence for the Account Deletion workflow — Fase 4.
 * The FIRST real I/O writer for `AccountDeletionRecord`/
 * `AccountDeletionLockDocument` (Fase 1-3 only ever operated on these in
 * memory).
 *
 * Paths (both backend-only — no Firestore Rule grants either collection to
 * a client; Admin SDK bypasses rules regardless, and Fase 0 already found
 * this repo's `firestore.rules` self-describes as "SUGESTÃO / pendente de
 * validação humana", so no assumption about deployed rules is made here
 * either way — the client is simply never given a path to read/write
 * these collections):
 *   - `accountDeletions/{deletionId}` — the full `AccountDeletionRecord`
 *     (Fase 1 report §6: lives in its own collection, never nested under
 *     `users/{uid}`, so it survives that document being hard-deleted).
 *   - `accountDeletionLocks/{uid}` — the tiny `AccountDeletionLockDocument`
 *     (Fase 1's `concurrency.ts`) that guarantees at most one non-terminal
 *     deletion per uid.
 */

import { db } from '../lib/firebaseAdmin';
import { createAccountDeletionRecord } from './record';
import { lockDocumentAfterCreate, resolveDeletionRequest } from './concurrency';
import type {
  AccountDeletionLockDocument,
  AccountDeletionPolicy,
  AccountDeletionRecord,
  AccountDeletionRequestMetadata,
  DeletionId,
  Uid,
} from './types';
import type { ProviderId } from './providerRevocation/types';

export const ACCOUNT_DELETIONS_COLLECTION = 'accountDeletions';
export const ACCOUNT_DELETION_LOCKS_COLLECTION = 'accountDeletionLocks';

function lockRef(uid: Uid) {
  return db.collection(ACCOUNT_DELETION_LOCKS_COLLECTION).doc(uid);
}

function recordRef(deletionId: DeletionId) {
  return db.collection(ACCOUNT_DELETIONS_COLLECTION).doc(deletionId);
}

export class AccountDeletionRepositoryError extends Error {
  constructor(reason: string) {
    super(`Account deletion repository inconsistency: ${reason}`);
    this.name = 'AccountDeletionRepositoryError';
  }
}

function isValidLockDocument(data: unknown): data is AccountDeletionLockDocument {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.uid === 'string' &&
    typeof d.activeDeletionId === 'string' &&
    typeof d.status === 'string' &&
    typeof d.revision === 'number'
  );
}

/**
 * Deliberately shallow — this is a defensive "is this even the shape we
 * wrote" check on a document only this backend ever writes, not a replay of
 * every Fase 1 invariant (those are enforced at WRITE time by
 * `createAccountDeletionRecord`/the pure transition functions, not
 * re-derived on every read).
 */
function isValidRecord(data: unknown): data is AccountDeletionRecord {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.deletionId === 'string' &&
    typeof d.uid === 'string' &&
    typeof d.workflowVersion === 'number' &&
    typeof d.status === 'string' &&
    typeof d.revision === 'number' &&
    typeof d.requestedAt === 'number' &&
    typeof d.steps === 'object' &&
    d.steps !== null &&
    typeof d.policy === 'object' &&
    d.policy !== null &&
    typeof d.providerRevocation === 'object' &&
    d.providerRevocation !== null
  );
}

export interface CreateOrReuseAccountDeletionResult {
  record: AccountDeletionRecord;
  /** `false` only when THIS call is the one that actually created the record. */
  deduplicated: boolean;
  /** `true` when the existing operation for this uid is `FAILED_TERMINAL` — see `concurrency.ts`'s `resolveDeletionRequest`. */
  blockedTerminalFailure: boolean;
}

export interface AccountDeletionRepository {
  createOrReuse(params: {
    uid: Uid;
    /** Pre-generated candidate id — used only if this call turns out to be the one that creates a new record (Fase 1 report §11). */
    candidateDeletionId: DeletionId;
    policy: AccountDeletionPolicy;
    linkedProviders: readonly ProviderId[];
    requestMetadata: AccountDeletionRequestMetadata;
    now: number;
  }): Promise<CreateOrReuseAccountDeletionResult>;
}

/**
 * Real Firestore implementation. The ENTIRE "is there already an active
 * operation for this uid" decision plus the record/lock creation happen
 * inside ONE transaction — Fase 4 §13: never a bare
 * check-then-await-then-create sequence, which would race two concurrent
 * calls into creating two independent operations for the same uid.
 */
export class FirestoreAccountDeletionRepository implements AccountDeletionRepository {
  async createOrReuse(params: {
    uid: Uid;
    candidateDeletionId: DeletionId;
    policy: AccountDeletionPolicy;
    linkedProviders: readonly ProviderId[];
    requestMetadata: AccountDeletionRequestMetadata;
    now: number;
  }): Promise<CreateOrReuseAccountDeletionResult> {
    return db.runTransaction(async (tx) => {
      // Every `tx.get` happens before any `tx.set` in every branch below —
      // required by Firestore transactions, and true here by construction.
      const lockSnap = await tx.get(lockRef(params.uid));

      let existingLock: AccountDeletionLockDocument | null = null;
      if (lockSnap.exists) {
        const data = lockSnap.data();
        if (!isValidLockDocument(data)) {
          throw new AccountDeletionRepositoryError('corrupted lock document');
        }
        existingLock = data;
      }

      const resolution = resolveDeletionRequest({
        existingLock,
        newDeletionId: params.candidateDeletionId,
      });

      if (resolution.kind === 'CREATED') {
        const record = createAccountDeletionRecord({
          deletionId: params.candidateDeletionId,
          uid: params.uid,
          policy: params.policy,
          now: params.now,
          requestMetadata: params.requestMetadata,
          linkedProviders: params.linkedProviders,
        });

        tx.set(lockRef(params.uid), lockDocumentAfterCreate(params.uid, params.candidateDeletionId));
        tx.set(recordRef(params.candidateDeletionId), record as unknown as FirebaseFirestore.DocumentData);

        return { record, deduplicated: false, blockedTerminalFailure: false };
      }

      // REUSED_EXISTING or BLOCKED_TERMINAL_FAILURE — read (never write) the
      // existing record inside the SAME transaction, so the caller sees a
      // consistent snapshot even under concurrent access.
      const existingRecordSnap = await tx.get(recordRef(resolution.deletionId));
      if (!existingRecordSnap.exists) {
        throw new AccountDeletionRepositoryError(
          'lock references a deletion record that does not exist',
        );
      }
      const data = existingRecordSnap.data();
      if (!isValidRecord(data)) {
        throw new AccountDeletionRepositoryError('corrupted deletion record');
      }

      return {
        record: data,
        deduplicated: resolution.kind === 'REUSED_EXISTING',
        blockedTerminalFailure: resolution.kind === 'BLOCKED_TERMINAL_FAILURE',
      };
    });
  }
}
