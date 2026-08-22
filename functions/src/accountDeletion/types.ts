/**
 * Core types for the Account Deletion workflow (Fase 1 — contrato técnico e
 * máquina de estados; see docs/25_exclusao_de_conta_arquitetura.md).
 *
 * This module and its siblings (`policy.ts`, `errors.ts`, `retry.ts`,
 * `concurrency.ts`, `steps.ts`, `stateMachine.ts`, `record.ts`,
 * `requestContract.ts`) are PURE: no Admin SDK call, no Firestore/Storage
 * read/write, no RevenueCat/Apple/Google I/O exists anywhere in this
 * directory. They define the contract a future orchestration worker (Fase 2+)
 * must implement against — see the Fase 1 report for what is deliberately
 * NOT built yet.
 */

import type { KnownErrorCode } from './errors';
import type { ProviderRevocationState } from './providerRevocation/types';

/** Firebase UID. Never trusted from a client-supplied request body — always `request.auth.uid`. */
export type Uid = string;

/**
 * Opaque identity of one deletion ATTEMPT, distinct from `Uid`. A uid has at
 * most one non-terminal deletion in flight at a time (enforced by the lock
 * document in `concurrency.ts`), but the deletion's own identity is never the
 * uid itself — see docs §5/§6 for why `users/{uid}` cannot double as the
 * workflow's system of record (it is one of the resources this workflow
 * deletes).
 */
export type DeletionId = string;

/**
 * Global status of one account deletion workflow instance.
 *
 * Deliberately includes `RETRY_SCHEDULED` as its own value rather than
 * folding "waiting for backoff" into `PROCESSING` — an operator (or a future
 * reconciliation job) needs to tell "a worker is actively running steps
 * right now" apart from "nothing is running, this will resume at
 * `nextAttemptAt`" without reading every step record. The alternative
 * (mirroring every step failure as a distinct global status, e.g.
 * `CLEANUP_FAILED`/`REVOCATION_FAILED`) was rejected: it multiplies global
 * states per step added and stops being a small, auditable machine — see the
 * Fase 1 report §3 for the explicit comparison.
 */
export type AccountDeletionStatus =
  | 'REQUESTED'
  | 'PROCESSING'
  | 'RETRY_SCHEDULED'
  | 'COMPLETED'
  | 'FAILED_TERMINAL';

/** Terminal global statuses — no outgoing transition exists from either (see `stateMachine.ts`). */
export const TERMINAL_ACCOUNT_DELETION_STATUSES: ReadonlySet<AccountDeletionStatus> = new Set([
  'COMPLETED',
  'FAILED_TERMINAL',
]);

/**
 * Canonical, dependency-ordered list of workflow steps. Order matters: a
 * step later in this list must never run before every EARLIER step required
 * by the active policy has reached an acceptable-for-completion status (see
 * `steps.ts`'s `nextRunnableStep`).
 *
 * `COMPLETION` is deliberately NOT a step here — it performs no I/O of its
 * own. It is the derived check ("are all required steps terminal-acceptable?")
 * that authorizes the global `PROCESSING -> COMPLETED` transition — see
 * `steps.ts`'s `isEligibleForCompletion` and `stateMachine.ts`'s
 * `transitionGlobal`.
 */
export const ACCOUNT_DELETION_STEP_NAMES = [
  'ACCOUNT_ACCESS_LOCK',
  'PROVIDER_REVOCATION',
  'VAULT_KEY_DESTRUCTION',
  'FIRESTORE_CLEANUP',
  'STORAGE_CLEANUP',
  'RETAINED_DATA_PROCESSING',
  'REVENUECAT_PROCESSING',
  'AUTH_DELETION',
] as const;

export type AccountDeletionStepName = (typeof ACCOUNT_DELETION_STEP_NAMES)[number];

/**
 * Status of a single step's execution.
 *
 * `SKIPPED_BY_POLICY` is distinct from `SUCCEEDED`: it means the step's
 * destructive action was intentionally not performed because the active
 * policy resolved to `RETAIN`/`SKIP` for everything that step is responsible
 * for (e.g. `RETAINED_DATA_PROCESSING` when policy says retain both support
 * and couponRedemptions) — not that the action ran and found nothing to do
 * (that case is `SUCCEEDED`, via the idempotent "already absent" path — see
 * `errors.ts`).
 */
export type AccountDeletionStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'SKIPPED_BY_POLICY'
  | 'FAILED_RETRYABLE'
  | 'FAILED_TERMINAL';

/** Step statuses with no outgoing transition (see `steps.ts`'s `canTransitionStep`). */
export const STEP_TERMINAL_STATUSES: ReadonlySet<AccountDeletionStepStatus> = new Set([
  'SUCCEEDED',
  'SKIPPED_BY_POLICY',
  'FAILED_TERMINAL',
]);

/** Step statuses that satisfy "this step is done for the purpose of completing the workflow". */
export const STEP_ACCEPTABLE_FOR_COMPLETION: ReadonlySet<AccountDeletionStepStatus> = new Set([
  'SUCCEEDED',
  'SKIPPED_BY_POLICY',
]);

export interface AccountDeletionStepRecord {
  status: AccountDeletionStepStatus;
  /** Number of RUNNING attempts started for this step, across all retries. */
  attemptCount: number;
  /** Epoch millis of the most recent attempt, or `null` before the first one. */
  lastAttemptAt: number | null;
  /** Epoch millis after which a retry worker may attempt this step again, or `null` when not waiting. */
  nextAttemptAt: number | null;
  /**
   * Sanitized, closed-vocabulary error code from the most recent failed
   * attempt — never a raw provider message or stack trace. `null` once the
   * step reaches `SUCCEEDED`/`SKIPPED_BY_POLICY`, or before any failure.
   */
  lastErrorCode: KnownErrorCode | null;
  /** Epoch millis the step reached a terminal status, or `null` while still PENDING/RUNNING/FAILED_RETRYABLE. */
  completedAt: number | null;
}

/**
 * How ONE optional data category is handled by a given workflow version.
 * `DELETE`/`ANONYMIZE`/`RETAIN`/`SKIP` are the only four actions — see the
 * Fase 0 report for why the categories below don't yet have a final legal
 * answer, and why the workflow must be able to express "retain everything"
 * without being redesigned once that answer arrives.
 */
export type RetentionAction = 'DELETE' | 'ANONYMIZE' | 'RETAIN' | 'SKIP';

/**
 * Action for the RevenueCat customer IDENTITY after Firestore/Storage/Auth
 * cleanup — e.g. deleting or anonymizing the `appUserID` record inside
 * RevenueCat. This is the same closed vocabulary as `RetentionAction` reused
 * under its own name for clarity at call sites, and it NEVER means canceling
 * the underlying Apple/Google native subscription. That is a completely
 * separate, user-driven (or, in the future, possibly a dedicated
 * integration's) action against the store — Fase 0 §3/§8: "excluir conta
 * AJ Fit ≠ cancelar assinatura". `REVENUECAT_PROCESSING` must never be
 * implemented, in any future phase, as "cancel the subscription".
 */
export type RevenueCatProcessingAction = RetentionAction;

export interface RetryConfig {
  /** Total attempts allowed for one step before it becomes `FAILED_TERMINAL` (the first attempt counts). */
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/** The three categories Fase 0 left pending, plus their eventual treatment — never chosen by the client, see `requestContract.ts`. */
export interface AccountDeletionRetentionPolicy {
  support: RetentionAction;
  couponRedemptions: RetentionAction;
  revenueCat: RevenueCatProcessingAction;
}

/**
 * A frozen, versioned snapshot of "what this workflow version does". Resolved
 * server-side exactly once, at request-creation time
 * (`resolveWorkflowPolicy(CURRENT_WORKFLOW_VERSION)` in `policy.ts`), and
 * never re-resolved for an in-flight deletion even if the backend deploys a
 * newer `CURRENT_WORKFLOW_VERSION` before the workflow finishes — see docs
 * §18. Structurally equal after creation is an invariant enforced by
 * `record.ts`'s `assertImmutableFieldsUnchanged`.
 */
export interface AccountDeletionPolicy {
  workflowVersion: number;
  retention: AccountDeletionRetentionPolicy;
  /**
   * Steps required for this policy version's workflow to reach `COMPLETED`.
   * `AUTH_DELETION` and `VAULT_KEY_DESTRUCTION` must always be present —
   * enforced by `policy.ts`'s `validatePolicy` — every other step's presence
   * is technically configurable per version, though v1 requires all eight
   * (see `policy.ts`).
   */
  requiredSteps: readonly AccountDeletionStepName[];
  retry: RetryConfig;
}

/** Lease held by one worker instance while actively executing steps — see `concurrency.ts`. */
export interface AccountDeletionLease {
  /** Opaque worker/process identity, never a user-facing value. */
  ownerId: string;
  expiresAt: number;
}

/**
 * Safe, closed-vocabulary telemetry captured once at request time. Never
 * free text, never a token, never PII beyond the uid already on the parent
 * record. `subscriptionActiveAtRequest` is metadata ONLY — Fase 0 §3 and
 * this phase's rule §19 both forbid it from gating any transition.
 */
export interface AccountDeletionRequestMetadata {
  subscriptionActiveAtRequest: boolean | null;
  /** `auth_time` (epoch seconds) from the verified ID token that satisfied recent-auth at request creation. */
  requestAuthTimeSeconds: number;
}

/**
 * The workflow's system of record for ONE deletion attempt. Lives in its own
 * top-level collection (conceptually `accountDeletions/{deletionId}` — see
 * docs §6), never nested under `users/{uid}`, specifically so it survives
 * `users/{uid}` being hard-deleted mid-workflow.
 *
 * Field mutability:
 *   - `deletionId`, `uid`, `workflowVersion`, `policy`, `requestedAt`,
 *     `requestMetadata`: immutable after creation.
 *   - `providerRevocation`: the `linked` flag on each sub-state is a
 *     snapshot frozen at creation (Fase 4 §21 — the worker must never
 *     re-read `providerData` mid-workflow to decide what originally needed
 *     revoking); the nested `step` record within each sub-state mutates
 *     exactly like any other step, through `steps.ts`'s transition
 *     functions (Fase 3, generalized to accept a string label).
 *   - `status`, `steps`, `updatedAt`, `completedAt`, `lease`, `revision`:
 *     mutated only through `stateMachine.ts`/`steps.ts`/`concurrency.ts`'s
 *     pure transition functions, never by direct field assignment.
 */
export interface AccountDeletionRecord {
  deletionId: DeletionId;
  uid: Uid;
  workflowVersion: number;
  policy: AccountDeletionPolicy;
  status: AccountDeletionStatus;
  steps: Readonly<Record<AccountDeletionStepName, AccountDeletionStepRecord>>;
  /**
   * Server-resolved snapshot of which federated providers were linked to
   * the Firebase Auth user AT REQUEST TIME (`admin.auth().getUser(uid)`,
   * never `request.data` — Fase 4 §20), plus each one's revocation
   * sub-step. See `providerRevocation/types.ts`'s `ProviderRevocationState`.
   */
  providerRevocation: ProviderRevocationState;
  /** Optimistic-concurrency token — see `concurrency.ts`'s `compareAndSet`. Strictly increases by 1 on every accepted write. */
  revision: number;
  requestedAt: number;
  updatedAt: number;
  completedAt: number | null;
  lease: AccountDeletionLease | null;
  requestMetadata: AccountDeletionRequestMetadata;
}

/**
 * Post-`COMPLETED` minimized shape — see `record.ts`'s `minimizeCompletedRecord`.
 * Drops per-attempt detail (attempt counts, error codes, lease) that has no
 * audit value once the workflow is done, keeping only what an eventual
 * "was this uid's deletion completed, and when" query needs. Whether/when
 * this record itself expires is `recordRetentionExpiresAt`,
 * `null` until a retention prazo is decided (Fase 0: `DECISÃO
 * JURÍDICA/NEGÓCIO NECESSÁRIA`) — the architecture supports expiry, it does
 * not invent a prazo.
 */
export interface AccountDeletionAuditRecord {
  deletionId: DeletionId;
  uid: Uid;
  workflowVersion: number;
  status: 'COMPLETED';
  requestedAt: number;
  completedAt: number;
  stepsSummary: Readonly<Record<AccountDeletionStepName, AccountDeletionStepStatus>>;
  recordRetentionExpiresAt: number | null;
}

/**
 * The uid-keyed lock used to guarantee at most one non-terminal deletion per
 * uid — see `concurrency.ts`'s `resolveDeletionRequest`. Deliberately tiny:
 * it exists to answer "is there already an active deletion for this uid",
 * not to duplicate the full record.
 */
export interface AccountDeletionLockDocument {
  uid: Uid;
  activeDeletionId: DeletionId;
  status: AccountDeletionStatus;
  revision: number;
}
