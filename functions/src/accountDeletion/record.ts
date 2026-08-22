/**
 * Deletion record lifecycle — creation, invariants and post-completion
 * minimization. Fase 1 report §5/§6/§22/§25.
 */

import { validatePolicy } from './policy';
import { initialStepRecords } from './steps';
import { ACCOUNT_DELETION_STEP_NAMES } from './types';
import type {
  AccountDeletionAuditRecord,
  AccountDeletionPolicy,
  AccountDeletionRecord,
  AccountDeletionRequestMetadata,
  AccountDeletionStatus,
  DeletionId,
  Uid,
} from './types';
import { canTransitionGlobal, isTerminalGlobalStatus } from './stateMachine';
import { initialProviderRevocationState } from './providerRevocation/types';
import type { ProviderId } from './providerRevocation/types';

/**
 * Creates a brand-new record in `REQUESTED`, all eight steps `PENDING`,
 * revision 0. The policy is validated once here (`validatePolicy`) and then
 * carried verbatim for the record's whole lifetime — see `policy.ts`'s doc
 * comment on why a resolved policy is never re-resolved mid-workflow.
 *
 * `linkedProviders` (Fase 4 §20/§21) must be resolved by the CALLER from
 * `admin.auth().getUser(uid)` — never from client input — and defaults to
 * `[]` only so Fase 1/2 callers/tests that predate provider revocation
 * keep compiling; a real `requestAccountDeletion` handler always passes the
 * server-resolved snapshot explicitly.
 */
export function createAccountDeletionRecord(params: {
  deletionId: DeletionId;
  uid: Uid;
  policy: AccountDeletionPolicy;
  now: number;
  requestMetadata: AccountDeletionRequestMetadata;
  linkedProviders?: readonly ProviderId[];
}): AccountDeletionRecord {
  validatePolicy(params.policy);

  return {
    deletionId: params.deletionId,
    uid: params.uid,
    workflowVersion: params.policy.workflowVersion,
    policy: params.policy,
    status: 'REQUESTED',
    steps: initialStepRecords(),
    providerRevocation: initialProviderRevocationState(params.linkedProviders ?? [], params.now),
    revision: 0,
    requestedAt: params.now,
    updatedAt: params.now,
    completedAt: null,
    lease: null,
    requestMetadata: params.requestMetadata,
  };
}

// ── Invariants ───────────────────────────────────────────────────────────

export class ImmutableFieldViolationError extends Error {
  constructor(public readonly field: string) {
    super(`Account deletion record field "${field}" is immutable after creation`);
    this.name = 'ImmutableFieldViolationError';
  }
}

export class StateRegressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateRegressionError';
  }
}

/** Structural equality sufficient for a plain-data policy snapshot (no functions, no cycles). */
function structurallyEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `uid`, `workflowVersion` and `policy` must never differ between any two
 * states of the SAME record — see Fase 1 report §25. Called by every mutator
 * that produces a "next" record from a "before" one.
 */
export function assertImmutableFieldsUnchanged(
  before: AccountDeletionRecord,
  after: AccountDeletionRecord,
): void {
  if (before.uid !== after.uid) throw new ImmutableFieldViolationError('uid');
  if (before.workflowVersion !== after.workflowVersion) {
    throw new ImmutableFieldViolationError('workflowVersion');
  }
  if (!structurallyEqual(before.policy, after.policy)) {
    throw new ImmutableFieldViolationError('policy');
  }
}

/**
 * Rejects a global-status change that is not a legal forward transition —
 * including the no-op `before === after` for a TERMINAL status, which is
 * still rejected because `COMPLETED`/`FAILED_TERMINAL` accept no outgoing
 * transition at all, not even to themselves (Fase 1 report §25: "COMPLETED
 * → estado terminal").
 */
export function assertNoGlobalRegression(
  before: AccountDeletionStatus,
  after: AccountDeletionStatus,
): void {
  // A same-to-same "transition" is a no-op ONLY for a non-terminal status
  // (e.g. two writes that both leave PROCESSING as PROCESSING). A terminal
  // status accepts zero outgoing transitions, including to itself — an
  // attempt to "re-apply" COMPLETED is still rejected.
  if (before === after && !isTerminalGlobalStatus(before)) return;
  if (!canTransitionGlobal(before, after)) {
    throw new StateRegressionError(`Illegal global transition: ${before} -> ${after}`);
  }
}

// ── Post-completion minimization (Fase 1 report §22) ────────────────────────

/**
 * Reduces a `COMPLETED` record to the minimal audit shape — drops per-step
 * attempt counts, error codes and the lease, keeps only uid/version/
 * timestamps/final step statuses. `recordRetentionExpiresAt` is left `null`
 * unless a caller supplies one: no prazo is invented here (Fase 0:
 * `DECISÃO JURÍDICA/NEGÓCIO NECESSÁRIA` on how long even this minimized
 * record may be kept) — the architecture supports expiry without asserting a
 * number.
 */
export function minimizeCompletedRecord(
  record: AccountDeletionRecord,
  recordRetentionExpiresAt: number | null = null,
): AccountDeletionAuditRecord {
  if (record.status !== 'COMPLETED' || record.completedAt === null) {
    throw new Error('Cannot minimize a record that has not reached COMPLETED');
  }

  const stepsSummary = Object.fromEntries(
    ACCOUNT_DELETION_STEP_NAMES.map((name) => [name, record.steps[name].status]),
  ) as AccountDeletionAuditRecord['stepsSummary'];

  return {
    deletionId: record.deletionId,
    uid: record.uid,
    workflowVersion: record.workflowVersion,
    status: 'COMPLETED',
    requestedAt: record.requestedAt,
    completedAt: record.completedAt,
    stepsSummary,
    recordRetentionExpiresAt,
  };
}

export function isAuditRecordExpired(record: AccountDeletionAuditRecord, now: number): boolean {
  return record.recordRetentionExpiresAt !== null && now >= record.recordRetentionExpiresAt;
}
