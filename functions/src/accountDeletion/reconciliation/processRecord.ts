/**
 * `processAccountDeletionRecord` — Fase 14's central abstraction.
 *
 * For ONE `deletionId`: load -> validate -> lease -> determine the next
 * runnable step (`../steps.ts`'s `nextRunnableStep`, never re-derived) ->
 * dispatch to the EXACT existing executor (`dispatcher.ts`) -> apply its
 * outcome through the EXACT existing transition functions
 * (`beginStepAttempt`/`completeStepAttempt`/`transitionGlobal`) -> persist
 * as ONE checkpoint (`recordAccess.ts`'s CAS-protected
 * `persistAccountDeletionRecordChange`, which also releases the lease in
 * the same write) -> decide whether to continue with another step in this
 * SAME invocation (bounded, see `DEFAULT_MAX_STEPS_PER_INVOCATION`) or stop.
 *
 * What this file deliberately does NOT do:
 *   - Reimplement the state machine, retry/backoff, error taxonomy, or any
 *     step executor — every one of those is imported unchanged.
 *   - Persist only once at the end of a multi-step run — every single step
 *     attempt is its own transaction, so a crash between steps N and N+1
 *     loses nothing already durably recorded.
 *   - Ever durably persist a step as `RUNNING` on its own — `beginStepAttempt`/
 *     `completeStepAttempt` are both called in-memory, synchronously, around
 *     ONE executor call, and only the FINAL resolved status is ever written.
 *     A crash mid-executor-call leaves the step exactly as it was before
 *     (still `PENDING`/`FAILED_RETRYABLE`) — the next reconciliation attempt
 *     simply retries the same (idempotent) executor call from scratch. A
 *     durably-persisted `RUNNING` would be a dead end: `steps.ts`'s
 *     `STEP_STATUS_TRANSITIONS` gives `RUNNING` no path back to itself, so a
 *     crash after that write would permanently strand the step.
 *   - Infer deletion intent from anything other than an existing record —
 *     every entry point here takes a `deletionId` that must already resolve
 *     to a persisted `AccountDeletionRecord`; nothing in this file ever
 *     scans `users`/Auth/Storage/RevenueCat to decide whether to act.
 */

import type { AccountDeletionStepOutcome, KnownErrorCode } from '../errors';
import { minimizeCompletedRecord } from '../record';
import { isTerminalGlobalStatus, transitionGlobal } from '../stateMachine';
import { beginStepAttempt, completeStepAttempt, isEligibleForCompletion, nextRunnableStep } from '../steps';
import {
  deriveProviderRevocationOutcome,
  nextRunnableProviderSubStep,
  providerSubStepLabel,
  type ProviderId,
  type ProviderRevocationState,
} from '../providerRevocation/types';
import type {
  AccountDeletionRecord,
  AccountDeletionStatus,
  AccountDeletionStepName,
  AccountDeletionStepStatus,
  DeletionId,
} from '../types';
import { logFunctionError, logInfo, logWarn } from '../../lib/logger';
import { runProviderSubStep, runTopLevelStep, type ProviderSubStepDispatcherDeps } from './dispatcher';
import {
  effectiveNextAttemptAt,
  isRecordDueNow,
  persistAccountDeletionRecordChange,
  readAccountDeletionRecord,
  tryAcquireReconciliationLease,
} from './recordAccess';
import { db } from '../../lib/firebaseAdmin';

/**
 * Where the minimized post-COMPLETED audit shape lives — deliberately a
 * SEPARATE collection from `accountDeletions` (`../repository.ts`'s
 * `ACCOUNT_DELETIONS_COLLECTION`), never an in-place overwrite of the live
 * record. Overwriting the live document would strip it down to
 * `AccountDeletionAuditRecord`'s shape (no `steps`/`policy`/
 * `providerRevocation`/`revision`), which breaks `readAccountDeletionRecord`'s
 * shape validation for anything that reads the SAME id again later (e.g. a
 * second `processAccountDeletionRecord` call correctly expecting
 * `ALREADY_TERMINAL`) — the full `COMPLETED` record must stay readable
 * forever; only a trimmed COPY is written here.
 */
const ACCOUNT_DELETION_AUDIT_COLLECTION = 'accountDeletionAudit';

const SCOPE = 'accountDeletion.reconciliation';

/**
 * How long a worker holds exclusive rights to ONE step attempt before the
 * lease is considered stale and another worker may take over — Fase 14
 * §"lease lifecycle". Sized generously above the slowest single step this
 * workflow performs (an Apple network round trip; Firestore/Storage cleanup
 * of a normal-sized account is far faster) without being so long that a
 * genuinely dead worker blocks reconciliation for an unreasonable time.
 * `compareAndSet`'s revision check is the actual correctness guarantee
 * regardless of this value — see `recordAccess.ts`'s doc comment.
 */
export const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000;

/**
 * Hard cap on how many step attempts ONE `processAccountDeletionRecord`
 * call may perform for a single record. A healthy record needs at most 8
 * (one per required step); 5 keeps a single record from consuming an
 * outsized share of one scheduler invocation's time budget while still
 * letting most records finish in one pass — a record needing more than 5
 * steps in one tick simply continues on the NEXT scheduler tick, exactly
 * like any other still-`PROCESSING` record (Fase 14 §"fairness").
 */
export const DEFAULT_MAX_STEPS_PER_INVOCATION = 5;

export interface ProcessAccountDeletionRecordOptions {
  /** Opaque identity of this worker instance/invocation — never user-facing. Used only for lease ownership. */
  ownerId: string;
  now?: number;
  leaseDurationMs?: number;
  maxStepsPerInvocation?: number;
  dispatcherDeps?: ProviderSubStepDispatcherDeps;
}

export type ProcessAccountDeletionRecordOutcome =
  | { kind: 'NOT_FOUND' }
  | { kind: 'ALREADY_TERMINAL'; status: AccountDeletionStatus }
  | { kind: 'NOT_DUE'; nextAttemptAt: number | null }
  | { kind: 'LEASE_HELD' }
  | { kind: 'STALE_WRITE_REJECTED'; stepsExecuted: number }
  | { kind: 'PROGRESSED'; stepsExecuted: number; finalStatus: AccountDeletionStatus };

function withoutRevision(record: AccountDeletionRecord): Omit<AccountDeletionRecord, 'revision'> {
  const { revision: _revision, ...rest } = record;
  return rest;
}

/**
 * Global status a set of (possibly just-updated) steps implies, given the
 * record's own frozen `policy.requiredSteps` — never re-derives which steps
 * are required, only reads what `policy` already says. Returns `'PROCESSING'`
 * when nothing terminal/complete/retry-worthy has happened yet — the caller
 * must NOT call `transitionGlobal` in that case (`PROCESSING -> PROCESSING`
 * is not a modeled transition; the record simply stays as-is).
 */
function resolveGlobalStatusFromSteps(
  policy: AccountDeletionRecord['policy'],
  steps: AccountDeletionRecord['steps'],
): AccountDeletionStatus {
  const relevant = policy.requiredSteps;
  if (relevant.some((name) => steps[name].status === 'FAILED_TERMINAL')) return 'FAILED_TERMINAL';
  if (relevant.some((name) => steps[name].status === 'FAILED_RETRYABLE')) return 'RETRY_SCHEDULED';
  if (isEligibleForCompletion(policy, steps)) return 'COMPLETED';
  return 'PROCESSING';
}

function eventNameForStepStatus(status: AccountDeletionStepStatus): string {
  switch (status) {
    case 'SUCCEEDED':
    case 'SKIPPED_BY_POLICY':
      return 'account_deletion_step_succeeded';
    case 'FAILED_RETRYABLE':
      return 'account_deletion_step_retry_scheduled';
    case 'FAILED_TERMINAL':
      return 'account_deletion_step_terminal_failure';
    default:
      return 'account_deletion_step_started';
  }
}

function terminalCodeFromProviderRevocation(state: ProviderRevocationState): KnownErrorCode {
  if (state.apple.step.status === 'FAILED_TERMINAL' && state.apple.step.lastErrorCode) {
    return state.apple.step.lastErrorCode;
  }
  if (state.google.step.status === 'FAILED_TERMINAL' && state.google.step.lastErrorCode) {
    return state.google.step.lastErrorCode;
  }
  return 'IMPOSSIBLE_STATE';
}

interface StepAttemptEnvelope {
  nextRecordWithoutRevision: Omit<AccountDeletionRecord, 'revision'>;
  attemptedStep: AccountDeletionStepName;
  attemptedProvider: ProviderId | null;
  attemptCount: number;
  errorCode: KnownErrorCode | null;
  nextAttemptAt: number | null;
  logEventName: string;
}

async function attemptTopLevelStep(
  step: Exclude<AccountDeletionStepName, 'PROVIDER_REVOCATION'>,
  processingRecord: AccountDeletionRecord,
  now: number,
): Promise<StepAttemptEnvelope> {
  const outcome: AccountDeletionStepOutcome = await runTopLevelStep(step, processingRecord);
  const running = beginStepAttempt(step, processingRecord.steps[step], now);
  const completed = completeStepAttempt(step, running, outcome, now, processingRecord.policy.retry);
  const newSteps = { ...processingRecord.steps, [step]: completed };

  const globalStatus = resolveGlobalStatusFromSteps(processingRecord.policy, newSteps);
  const merged: AccountDeletionRecord = { ...processingRecord, steps: newSteps, updatedAt: now };
  const finalRecord = globalStatus === 'PROCESSING' ? merged : transitionGlobal(merged, globalStatus, now);

  return {
    nextRecordWithoutRevision: { ...withoutRevision(finalRecord), lease: null },
    attemptedStep: step,
    attemptedProvider: null,
    attemptCount: completed.attemptCount,
    errorCode: completed.lastErrorCode,
    nextAttemptAt: completed.nextAttemptAt,
    logEventName: eventNameForStepStatus(completed.status),
  };
}

async function attemptProviderRevocation(
  processingRecord: AccountDeletionRecord,
  now: number,
  deps: ProviderSubStepDispatcherDeps,
): Promise<StepAttemptEnvelope> {
  const aggregateBefore = deriveProviderRevocationOutcome(processingRecord.providerRevocation);

  let newProviderRevocation = processingRecord.providerRevocation;
  let attemptedProvider: ProviderId | null = null;
  let errorCode: KnownErrorCode | null = null;
  let nextAttemptAt: number | null = null;
  let resolvedSubStatus: AccountDeletionStepStatus | null = null;

  if (aggregateBefore === 'NOT_DONE') {
    const provider = nextRunnableProviderSubStep(processingRecord.providerRevocation);
    if (provider === null) {
      // Cannot happen: `deriveProviderRevocationOutcome` only reports
      // `NOT_DONE` when at least one sub-step is neither terminal-failed
      // nor acceptable-for-completion, which is exactly when
      // `nextRunnableProviderSubStep` returns non-null.
      throw new Error(
        'IMPOSSIBLE_STATE: PROVIDER_REVOCATION reported NOT_DONE with no runnable sub-step',
      );
    }
    attemptedProvider = provider;

    const outcome = await runProviderSubStep(provider, processingRecord, deps);
    if (outcome.kind === 'FAILED') errorCode = outcome.code;

    const label = providerSubStepLabel(provider);
    const providerKey: 'apple' | 'google' = provider === 'apple.com' ? 'apple' : 'google';
    const currentSub = processingRecord.providerRevocation[providerKey];
    const running = beginStepAttempt(label, currentSub.step, now);
    const completedSub = completeStepAttempt(label, running, outcome, now, processingRecord.policy.retry);

    newProviderRevocation = {
      ...processingRecord.providerRevocation,
      [providerKey]: { ...currentSub, step: completedSub },
    };
    nextAttemptAt = completedSub.nextAttemptAt;
    resolvedSubStatus = completedSub.status;
  }

  const aggregateAfter = deriveProviderRevocationOutcome(newProviderRevocation);
  let newOuterStep = processingRecord.steps.PROVIDER_REVOCATION;
  if (aggregateAfter !== 'NOT_DONE') {
    const outerOutcome: AccountDeletionStepOutcome =
      aggregateAfter === 'SUCCEEDED'
        ? { kind: 'SUCCEEDED' }
        : { kind: 'FAILED', code: terminalCodeFromProviderRevocation(newProviderRevocation) };
    const runningOuter = beginStepAttempt(
      'PROVIDER_REVOCATION',
      processingRecord.steps.PROVIDER_REVOCATION,
      now,
    );
    newOuterStep = completeStepAttempt(
      'PROVIDER_REVOCATION',
      runningOuter,
      outerOutcome,
      now,
      processingRecord.policy.retry,
    );
  }

  const newSteps = { ...processingRecord.steps, PROVIDER_REVOCATION: newOuterStep };
  const globalStatus = resolveGlobalStatusFromSteps(processingRecord.policy, newSteps);
  const merged: AccountDeletionRecord = {
    ...processingRecord,
    steps: newSteps,
    providerRevocation: newProviderRevocation,
    updatedAt: now,
  };
  const finalRecord = globalStatus === 'PROCESSING' ? merged : transitionGlobal(merged, globalStatus, now);

  return {
    nextRecordWithoutRevision: { ...withoutRevision(finalRecord), lease: null },
    attemptedStep: 'PROVIDER_REVOCATION',
    attemptedProvider,
    attemptCount: newOuterStep.attemptCount,
    errorCode,
    nextAttemptAt,
    logEventName: eventNameForStepStatus(resolvedSubStatus ?? newOuterStep.status),
  };
}

async function attemptCompletion(processingRecord: AccountDeletionRecord, now: number): Promise<StepAttemptEnvelope> {
  const completedRecord = transitionGlobal(processingRecord, 'COMPLETED', now);
  return {
    nextRecordWithoutRevision: { ...withoutRevision(completedRecord), lease: null },
    attemptedStep: 'AUTH_DELETION',
    attemptedProvider: null,
    attemptCount: 0,
    errorCode: null,
    nextAttemptAt: null,
    logEventName: 'account_deletion_reconciliation_completed',
  };
}

async function attemptNextStepOrComplete(
  leased: AccountDeletionRecord,
  now: number,
  deps: ProviderSubStepDispatcherDeps,
): Promise<StepAttemptEnvelope> {
  const processingRecord: AccountDeletionRecord =
    leased.status === 'PROCESSING' ? leased : transitionGlobal(leased, 'PROCESSING', now);

  const step = nextRunnableStep(processingRecord.policy, processingRecord.steps);
  if (step === null) return attemptCompletion(processingRecord, now);
  if (step === 'PROVIDER_REVOCATION') return attemptProviderRevocation(processingRecord, now, deps);
  return attemptTopLevelStep(step, processingRecord, now);
}

/**
 * Best-effort post-COMPLETED minimization (`../record.ts`'s
 * `minimizeCompletedRecord`, Fase 1, previously never called by any
 * production code). Runs only AFTER the full `COMPLETED` record is already
 * durably persisted (never before) — a failure here is logged and swallowed,
 * never allowed to make an already-successful deletion look incomplete. The
 * live `accountDeletions/{deletionId}` document is left fully intact; the
 * minimized shape is written to `accountDeletionAudit/{deletionId}` instead
 * — see this file's collection-name doc comment for why. `recordRetentionExpiresAt`
 * stays `null` — Fase 0/1: no retention prazo is invented here.
 */
async function finalizeCompletedRecord(record: AccountDeletionRecord): Promise<void> {
  try {
    const minimized = minimizeCompletedRecord(record, null);
    await db
      .collection(ACCOUNT_DELETION_AUDIT_COLLECTION)
      .doc(record.deletionId)
      .set(minimized as unknown as FirebaseFirestore.DocumentData);
  } catch (error) {
    logFunctionError(SCOPE, error, { uid: record.uid });
  }
}

/**
 * Advances ONE `AccountDeletionRecord` by up to `maxStepsPerInvocation`
 * steps. Never called with anything other than an EXISTING `deletionId` —
 * see this file's module doc comment on why that alone is the sole
 * authorization to act.
 */
export async function processAccountDeletionRecord(
  deletionId: DeletionId,
  options: ProcessAccountDeletionRecordOptions,
): Promise<ProcessAccountDeletionRecordOutcome> {
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const maxSteps = options.maxStepsPerInvocation ?? DEFAULT_MAX_STEPS_PER_INVOCATION;

  let stepsExecuted = 0;
  let lastStatus: AccountDeletionStatus = 'REQUESTED';

  for (let i = 0; i < maxSteps; i += 1) {
    const now = options.now ?? Date.now();
    const current = await readAccountDeletionRecord(deletionId);

    if (current === null) {
      if (stepsExecuted === 0) return { kind: 'NOT_FOUND' };
      break;
    }
    lastStatus = current.status;

    if (isTerminalGlobalStatus(current.status)) {
      if (stepsExecuted === 0) return { kind: 'ALREADY_TERMINAL', status: current.status };
      break;
    }

    if (!isRecordDueNow(current, now)) {
      if (stepsExecuted === 0) return { kind: 'NOT_DUE', nextAttemptAt: effectiveNextAttemptAt(current) };
      break;
    }

    const leaseResult = await tryAcquireReconciliationLease(deletionId, options.ownerId, now, leaseDurationMs);
    if (!leaseResult.ok) {
      if (stepsExecuted === 0) {
        return leaseResult.reason === 'NOT_FOUND' ? { kind: 'NOT_FOUND' } : { kind: 'LEASE_HELD' };
      }
      break;
    }
    const leased = leaseResult.record;

    // Re-validate against the FRESH, transactionally-read snapshot the
    // lease itself just returned — the earlier `current` read above is
    // non-transactional and can be stale by the time the lease is granted
    // (e.g. a concurrent worker completed the SAME record in between).
    // Never act on a status observed before the lease was acquired.
    if (isTerminalGlobalStatus(leased.status)) {
      if (stepsExecuted === 0) return { kind: 'ALREADY_TERMINAL', status: leased.status };
      break;
    }
    if (!isRecordDueNow(leased, now)) {
      if (stepsExecuted === 0) return { kind: 'NOT_DUE', nextAttemptAt: effectiveNextAttemptAt(leased) };
      break;
    }

    logInfo(SCOPE, 'account_deletion_step_started', {
      deletionId,
      uid: leased.uid,
      status: leased.status,
      revision: leased.revision,
    });

    const attempt = await attemptNextStepOrComplete(leased, now, options.dispatcherDeps ?? {});

    const persistResult = await persistAccountDeletionRecordChange(
      deletionId,
      leased.revision,
      () => attempt.nextRecordWithoutRevision,
    );

    if (!persistResult.ok) {
      // Another writer (a second worker that acquired the lease after ours
      // expired, or otherwise) already advanced the revision — never
      // overwrite. Stop working this record THIS invocation; a future
      // invocation re-reads genuinely current state.
      logWarn(SCOPE, 'account_deletion_reconciliation_stale_write_rejected', {
        deletionId,
        uid: leased.uid,
        currentRevision: persistResult.currentRevision,
      });
      return { kind: 'STALE_WRITE_REJECTED', stepsExecuted };
    }

    stepsExecuted += 1;
    lastStatus = persistResult.value.status;

    logInfo(SCOPE, attempt.logEventName, {
      deletionId,
      uid: leased.uid,
      step: attempt.attemptedStep,
      provider: attempt.attemptedProvider ?? undefined,
      status: persistResult.value.status,
      attemptCount: attempt.attemptCount,
      revision: persistResult.value.revision,
      nextAttemptAt: attempt.nextAttemptAt ?? undefined,
      lastErrorCode: attempt.errorCode ?? undefined,
    });

    if (persistResult.value.status === 'COMPLETED') {
      await finalizeCompletedRecord(persistResult.value);
      logInfo(SCOPE, 'account_deletion_reconciliation_completed', { deletionId, uid: persistResult.value.uid });
      break;
    }
    if (persistResult.value.status === 'FAILED_TERMINAL') {
      logWarn(SCOPE, 'account_deletion_step_terminal_failure', {
        deletionId,
        uid: persistResult.value.uid,
        lastErrorCode: attempt.errorCode ?? undefined,
      });
      break;
    }
    if (persistResult.value.status === 'RETRY_SCHEDULED') {
      // Never busy-wait within this invocation for the backoff to elapse —
      // stop here; a later scheduler tick (or the candidate query's next
      // pass) revisits this record once `nextAttemptAt` is due.
      break;
    }
    // Still PROCESSING — loop continues to the next step, bounded by maxSteps.
  }

  return { kind: 'PROGRESSED', stepsExecuted, finalStatus: lastStatus };
}
