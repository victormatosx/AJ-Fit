import { RecoveryError } from './errors';

/**
 * MFA Recovery — the three state machines, as data.
 *
 * These are declared as explicit adjacency maps rather than as `if` chains so
 * that "which transitions exist" is a value the tests can enumerate: a test
 * can assert that every pair NOT in the map is rejected, which is the only way
 * to be confident an illegal transition is actually impossible.
 *
 * PHASE 1 SCOPE: pure predicates. Nothing here reads or writes Firestore, and
 * nothing here performs a transition — callers in later phases apply these
 * decisions inside a Firestore transaction.
 */

export type RecoverySetStatus = 'active' | 'rotated' | 'exhausted';
export type RecoveryCodeState = 'available' | 'reserved' | 'consumed';
export type RecoveryOperationState = 'reserved' | 'resetting' | 'completed' | 'failed';

/**
 * RECOVERY CODE:  available -> reserved -> consumed
 *
 * `available -> consumed` is FORBIDDEN even though it looks like a harmless
 * shortcut. The reserve step is the entire basis of the idempotency story: it
 * is the durable record, written before any Admin SDK call, that says "this
 * code is now spoken for by operation X". Skipping it means a process that
 * dies mid-reset leaves a code that still reads as `available`, and the retry
 * spends a second code — or, worse, two concurrent requests both observe
 * `available` and both proceed.
 *
 * `reserved -> available` is FORBIDDEN. A reservation is never released, not
 * even when the operation fails permanently. Releasing it would reopen the
 * double-spend window that reserving exists to close, and would let an
 * attacker who can force failures replay one code indefinitely. The cost of
 * failing closed is one burned code out of a set; the cost of failing open is
 * an unbounded replay. Phase 3 must therefore surface "that code is spent,
 * use another" rather than silently recycling it.
 *
 * `consumed` is terminal. No self-transitions: a repeated reserve is a retry
 * question, answered by idempotency.ts, not a state question.
 */
export const RECOVERY_CODE_TRANSITIONS: Readonly<
  Record<RecoveryCodeState, readonly RecoveryCodeState[]>
> = {
  available: ['reserved'],
  reserved: ['consumed'],
  consumed: [],
};

/**
 * RECOVERY SET:  active -> exhausted -> rotated
 *                active -> rotated
 *
 * `active`     the current set; the only status that can authorize a reset.
 * `exhausted`  every code consumed. Materialized rather than derived from the
 *              codes array so that the "you have no codes left" decision is a
 *              single field read, and so the moment of exhaustion has a
 *              timestamped, auditable transition.
 * `rotated`    superseded by a newer set. Terminal.
 *
 * Nothing ever returns to `active`. A set that stopped being current cannot
 * become current again — regeneration always mints a NEW set with a new
 * selector, which also means codes printed from the old set can no longer even
 * locate a document.
 *
 * NO FOURTH STATE. A `revoked` status was considered for "user disabled TOTP
 * entirely" and rejected as a state with no concrete job: with no enrolled
 * factor there is nothing for a recovery code to reset, and re-enrolling mints
 * a fresh set which moves the old one to `rotated`. Phase 3 enforces that as a
 * precondition check at reset time, which is where it belongs, instead of as a
 * status nobody transitions out of.
 */
export const RECOVERY_SET_TRANSITIONS: Readonly<
  Record<RecoverySetStatus, readonly RecoverySetStatus[]>
> = {
  active: ['exhausted', 'rotated'],
  exhausted: ['rotated'],
  rotated: [],
};

/**
 * RECOVERY OPERATION:  reserved -> resetting -> completed
 *                      reserved -> failed
 *                      resetting -> failed
 *
 * `reserved`   the code is durably reserved; NOTHING external has happened
 *              yet. A crash here is fully safe to retry.
 * `resetting`  the Admin SDK reset may have started. This is the dangerous
 *              window, and it is exactly why the state is written BEFORE the
 *              call: a retry that finds `resetting` knows the reset may or may
 *              not have landed, and re-running it is safe because removing all
 *              second factors is naturally idempotent — the end state is the
 *              same whether it runs once or three times.
 * `completed`  reset done, sessions revoked, code consumed. Terminal.
 * `failed`     terminal, deterministic failure. Reserved for errors a retry
 *              cannot fix (the set rotated mid-flight, a precondition broke).
 *              A transient crash must NOT be recorded as `failed` — it simply
 *              leaves the operation in `reserved`/`resetting` for the retry to
 *              pick up.
 *
 * Self-transitions ARE permitted here, unlike for codes: `reserved -> reserved`
 * and `resetting -> resetting` are how an idempotent retry re-affirms the
 * state it already found. They are declared explicitly so the intent is
 * visible rather than implied.
 *
 * `resetting -> reserved` is forbidden: once the external call may have
 * happened, the record must never claim it has not.
 */
export const RECOVERY_OPERATION_TRANSITIONS: Readonly<
  Record<RecoveryOperationState, readonly RecoveryOperationState[]>
> = {
  reserved: ['reserved', 'resetting', 'failed'],
  resetting: ['resetting', 'completed', 'failed'],
  completed: [],
  failed: [],
};

/** States from which an operation can still make progress. */
export const IN_FLIGHT_OPERATION_STATES: readonly RecoveryOperationState[] = [
  'reserved',
  'resetting',
];

/** States from which an operation can never make progress again. */
export const TERMINAL_OPERATION_STATES: readonly RecoveryOperationState[] = [
  'completed',
  'failed',
];

export function isInFlightOperation(state: RecoveryOperationState): boolean {
  return IN_FLIGHT_OPERATION_STATES.includes(state);
}

export function isTerminalOperation(state: RecoveryOperationState): boolean {
  return TERMINAL_OPERATION_STATES.includes(state);
}

function canTransition<S extends string>(
  transitions: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): boolean {
  const allowed = transitions[from];
  return allowed !== undefined && allowed.includes(to);
}

export function canTransitionRecoveryCode(
  from: RecoveryCodeState,
  to: RecoveryCodeState,
): boolean {
  return canTransition(RECOVERY_CODE_TRANSITIONS, from, to);
}

export function canTransitionRecoverySet(
  from: RecoverySetStatus,
  to: RecoverySetStatus,
): boolean {
  return canTransition(RECOVERY_SET_TRANSITIONS, from, to);
}

export function canTransitionRecoveryOperation(
  from: RecoveryOperationState,
  to: RecoveryOperationState,
): boolean {
  return canTransition(RECOVERY_OPERATION_TRANSITIONS, from, to);
}

/**
 * Throwing variants. Later phases call these immediately before staging a
 * write inside a transaction, so an illegal transition aborts the transaction
 * instead of being persisted.
 */
export function assertRecoveryCodeTransition(
  from: RecoveryCodeState,
  to: RecoveryCodeState,
): void {
  if (!canTransitionRecoveryCode(from, to)) {
    throw new RecoveryError('INVALID_STATE_TRANSITION');
  }
}

export function assertRecoverySetTransition(
  from: RecoverySetStatus,
  to: RecoverySetStatus,
): void {
  if (!canTransitionRecoverySet(from, to)) {
    throw new RecoveryError('INVALID_STATE_TRANSITION');
  }
}

export function assertRecoveryOperationTransition(
  from: RecoveryOperationState,
  to: RecoveryOperationState,
): void {
  if (!canTransitionRecoveryOperation(from, to)) {
    throw new RecoveryError('INVALID_STATE_TRANSITION');
  }
}
