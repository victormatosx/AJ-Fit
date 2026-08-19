import type { RecoveryInternalCode } from './errors';
import type { RecoveryOperation } from './schema';
import { isInFlightOperation } from './stateMachine';

/**
 * MFA Recovery — idempotency contract.
 *
 * THE FAILURE THIS EXISTS FOR
 * ---------------------------
 *     Firestore reserves a code
 *              |
 *     Admin Auth begins removing the second factor
 *              |
 *     the process dies
 *
 * and then a retry arrives. The retry must not:
 *   - spend a second recovery code,
 *   - start a second concurrent reset,
 *   - release the reservation the dead attempt made,
 *   - or leave the set in a state nobody can interpret.
 *
 * The answer is a single `activeOperation` slot on the recovery set, keyed by
 * `operationId`, plus this pure decision function. Persisting the operation
 * BEFORE the Admin SDK call is what makes the window recoverable: a retry can
 * always tell whether the external call may already have happened.
 *
 * Re-running the reset itself is safe. Removing every enrolled second factor
 * is naturally idempotent — the end state is identical whether it runs once or
 * three times — which is why `resetting` is resumable rather than fatal.
 *
 *
 * WHERE operationId COMES FROM
 * ----------------------------
 * The SERVER generates it (Phase 2, from `crypto.randomUUID()`), returns it,
 * and the client echoes it back on retry. It is deliberately not a
 * client-chosen idempotency key: a caller who has not completed MFA must not
 * get to pick identifiers that address server-side state, or they could probe
 * for in-flight operations belonging to other people.
 *
 *
 * PHASE 1 SCOPE: a pure function over values. No Firestore, no transaction, no
 * Admin SDK. Later phases call this inside a transaction and apply the result.
 */

export type RecoveryOperationDecision =
  /** No operation in the slot, or the previous one finished. Mint a new one. */
  | { readonly kind: 'start' }
  /** Same operationId, same code, still in flight. Continue where it left off. */
  | { readonly kind: 'resume'; readonly operation: RecoveryOperation }
  /** Same operationId, already finished successfully. Return success again. */
  | { readonly kind: 'alreadyCompleted'; readonly operation: RecoveryOperation }
  /** Same operationId, already failed terminally. Do not retry it. */
  | { readonly kind: 'terminalFailure'; readonly operation: RecoveryOperation }
  /** Refuse: acting would corrupt or hijack an existing reservation. */
  | { readonly kind: 'conflict'; readonly internalCode: RecoveryInternalCode };

export interface RecoveryOperationDecisionInput {
  /** Current contents of `RecoverySetDocument.activeOperation`. */
  readonly activeOperation: RecoveryOperation | null;
  /** The operationId presented by this request; null on a first attempt. */
  readonly incomingOperationId: string | null;
  /** `RecoveryCodeRecord.id` of the code this request matched. */
  readonly codeId: string;
}

/**
 * Decides what a recovery request should do given the set's current operation.
 *
 * The rules, and why each one is the way it is:
 *
 * 1. EMPTY SLOT -> start.
 *    Nothing is in flight. A presented operationId that matches nothing is
 *    ignored rather than trusted: the slot is the only source of truth, so an
 *    unknown id cannot resurrect a reservation that no longer exists.
 *
 * 2. TERMINAL OPERATION, DIFFERENT ID -> start.
 *    The previous attempt is over. A new attempt may begin — against a
 *    different code, because the previous one is consumed or burned.
 *
 * 3. SAME ID, SAME CODE -> resume / alreadyCompleted / terminalFailure.
 *    This is the retry path. `completed` replays the success (the caller
 *    simply lost the response); `failed` is reported as-is so a client cannot
 *    convert a terminal failure into a fresh attempt by retrying; in-flight
 *    states resume.
 *
 * 4. SAME ID, DIFFERENT CODE -> conflict.
 *    An operationId is bound to exactly one code at reservation time. The same
 *    id arriving for a different code means either a client bug or an attempt
 *    to re-point a reservation, and adopting it would consume a second code
 *    under the identity of the first. This is the case the requirement
 *    "different operation ids must not silently assume the same reservation"
 *    is aimed at, and it is refused in BOTH directions: a different id cannot
 *    take over this reservation (rule 5), and this id cannot take over a
 *    different code.
 *
 * 5. DIFFERENT ID, OPERATION STILL IN FLIGHT -> conflict.
 *    A second reset while one is running would race the Admin SDK call and
 *    could consume two codes for one recovery. One at a time, always.
 *
 * Note what is absent: no branch anywhere returns a code to `available`, and
 * no branch clears a reservation. A burned code stays burned — see the
 * fail-closed reasoning in stateMachine.ts.
 */
export function decideRecoveryOperation(
  input: RecoveryOperationDecisionInput,
): RecoveryOperationDecision {
  const { activeOperation, incomingOperationId, codeId } = input;

  // Rule 1 — nothing in flight.
  if (activeOperation === null) {
    return { kind: 'start' };
  }

  const isSameOperation =
    incomingOperationId !== null && incomingOperationId === activeOperation.operationId;

  if (isSameOperation) {
    // Rule 4 — the id is bound to a different code. Never re-point it.
    if (activeOperation.codeId !== codeId) {
      return { kind: 'conflict', internalCode: 'OPERATION_CONFLICT' };
    }

    // Rule 3 — genuine retry of this exact operation.
    switch (activeOperation.state) {
      case 'completed':
        return { kind: 'alreadyCompleted', operation: activeOperation };
      case 'failed':
        return { kind: 'terminalFailure', operation: activeOperation };
      default:
        return { kind: 'resume', operation: activeOperation };
    }
  }

  // Rule 5 — someone else's operation is still running.
  if (isInFlightOperation(activeOperation.state)) {
    return {
      kind: 'conflict',
      internalCode:
        activeOperation.codeId === codeId ? 'CODE_ALREADY_RESERVED' : 'OPERATION_CONFLICT',
    };
  }

  // Rule 2 — the slot holds a finished operation; a new one may take over.
  return { kind: 'start' };
}
