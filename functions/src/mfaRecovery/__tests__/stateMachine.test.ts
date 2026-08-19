import { describe, expect, it } from 'vitest';

import { RecoveryError } from '../errors';
import {
  RECOVERY_CODE_TRANSITIONS,
  RECOVERY_OPERATION_TRANSITIONS,
  RECOVERY_SET_TRANSITIONS,
  type RecoveryCodeState,
  type RecoveryOperationState,
  type RecoverySetStatus,
  assertRecoveryCodeTransition,
  assertRecoveryOperationTransition,
  assertRecoverySetTransition,
  canTransitionRecoveryCode,
  canTransitionRecoveryOperation,
  canTransitionRecoverySet,
  isInFlightOperation,
  isTerminalOperation,
} from '../stateMachine';

const CODE_STATES: readonly RecoveryCodeState[] = ['available', 'reserved', 'consumed'];
const SET_STATUSES: readonly RecoverySetStatus[] = ['active', 'rotated', 'exhausted'];
const OPERATION_STATES: readonly RecoveryOperationState[] = [
  'reserved',
  'resetting',
  'completed',
  'failed',
];

/**
 * Enumerates every ordered pair and asserts the predicate agrees with the
 * declared adjacency map. This is the assertion that actually proves illegal
 * transitions are impossible — spot-checking a few pairs would not.
 */
function assertExhaustive<S extends string>(
  states: readonly S[],
  transitions: Readonly<Record<S, readonly S[]>>,
  predicate: (from: S, to: S) => boolean,
): void {
  for (const from of states) {
    for (const to of states) {
      expect(predicate(from, to)).toBe(transitions[from].includes(to));
    }
  }
}

describe('recovery code state machine', () => {
  it('allows exactly available -> reserved -> consumed', () => {
    expect(canTransitionRecoveryCode('available', 'reserved')).toBe(true);
    expect(canTransitionRecoveryCode('reserved', 'consumed')).toBe(true);
  });

  it('forbids skipping the reservation step', () => {
    // The reserve write is the durable record that makes a retry idempotent;
    // skipping it reopens the double-spend window.
    expect(canTransitionRecoveryCode('available', 'consumed')).toBe(false);
    expect(() => assertRecoveryCodeTransition('available', 'consumed')).toThrow(RecoveryError);
  });

  it('never releases a reservation', () => {
    // Fail closed: a burned code costs one code, a released one allows replay.
    expect(canTransitionRecoveryCode('reserved', 'available')).toBe(false);
    expect(canTransitionRecoveryCode('consumed', 'available')).toBe(false);
    expect(canTransitionRecoveryCode('consumed', 'reserved')).toBe(false);
  });

  it('treats consumed as terminal', () => {
    expect(RECOVERY_CODE_TRANSITIONS.consumed).toEqual([]);
  });

  it('forbids self-transitions', () => {
    for (const state of CODE_STATES) {
      expect(canTransitionRecoveryCode(state, state)).toBe(false);
    }
  });

  it('rejects every pair outside the declared map', () => {
    assertExhaustive(CODE_STATES, RECOVERY_CODE_TRANSITIONS, canTransitionRecoveryCode);
  });

  it('throws INVALID_STATE_TRANSITION on an illegal transition', () => {
    try {
      assertRecoveryCodeTransition('consumed', 'available');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as RecoveryError).internalCode).toBe('INVALID_STATE_TRANSITION');
    }
  });

  it('does not throw on a legal transition', () => {
    expect(() => assertRecoveryCodeTransition('available', 'reserved')).not.toThrow();
    expect(() => assertRecoveryCodeTransition('reserved', 'consumed')).not.toThrow();
  });
});

describe('recovery set state machine', () => {
  it('allows active -> exhausted, active -> rotated and exhausted -> rotated', () => {
    expect(canTransitionRecoverySet('active', 'exhausted')).toBe(true);
    expect(canTransitionRecoverySet('active', 'rotated')).toBe(true);
    expect(canTransitionRecoverySet('exhausted', 'rotated')).toBe(true);
  });

  it('never reactivates a set', () => {
    // Regeneration mints a NEW set with a new selector; the old one is dead.
    expect(canTransitionRecoverySet('rotated', 'active')).toBe(false);
    expect(canTransitionRecoverySet('exhausted', 'active')).toBe(false);
  });

  it('treats rotated as terminal', () => {
    expect(RECOVERY_SET_TRANSITIONS.rotated).toEqual([]);
  });

  it('defines exactly three statuses, with no state that lacks a job', () => {
    expect(Object.keys(RECOVERY_SET_TRANSITIONS).sort()).toEqual(
      ['active', 'exhausted', 'rotated'].sort(),
    );
  });

  it('rejects every pair outside the declared map', () => {
    assertExhaustive(SET_STATUSES, RECOVERY_SET_TRANSITIONS, canTransitionRecoverySet);
  });

  it('throws on an illegal transition', () => {
    expect(() => assertRecoverySetTransition('rotated', 'active')).toThrow(RecoveryError);
  });
});

describe('recovery operation state machine', () => {
  it('allows the happy path reserved -> resetting -> completed', () => {
    expect(canTransitionRecoveryOperation('reserved', 'resetting')).toBe(true);
    expect(canTransitionRecoveryOperation('resetting', 'completed')).toBe(true);
  });

  it('allows failing from either in-flight state', () => {
    expect(canTransitionRecoveryOperation('reserved', 'failed')).toBe(true);
    expect(canTransitionRecoveryOperation('resetting', 'failed')).toBe(true);
  });

  it('permits self-transitions so an idempotent retry can re-affirm state', () => {
    expect(canTransitionRecoveryOperation('reserved', 'reserved')).toBe(true);
    expect(canTransitionRecoveryOperation('resetting', 'resetting')).toBe(true);
  });

  it('never walks back from resetting to reserved', () => {
    // Once the Admin SDK call may have happened, the record must not claim
    // otherwise.
    expect(canTransitionRecoveryOperation('resetting', 'reserved')).toBe(false);
  });

  it('never skips straight from reserved to completed', () => {
    expect(canTransitionRecoveryOperation('reserved', 'completed')).toBe(false);
  });

  it('treats completed and failed as terminal', () => {
    expect(RECOVERY_OPERATION_TRANSITIONS.completed).toEqual([]);
    expect(RECOVERY_OPERATION_TRANSITIONS.failed).toEqual([]);

    for (const to of OPERATION_STATES) {
      expect(canTransitionRecoveryOperation('completed', to)).toBe(false);
      expect(canTransitionRecoveryOperation('failed', to)).toBe(false);
    }
  });

  it('rejects every pair outside the declared map', () => {
    assertExhaustive(
      OPERATION_STATES,
      RECOVERY_OPERATION_TRANSITIONS,
      canTransitionRecoveryOperation,
    );
  });

  it('classifies in-flight and terminal states without overlap', () => {
    for (const state of OPERATION_STATES) {
      expect(isInFlightOperation(state)).toBe(!isTerminalOperation(state));
    }

    expect(isInFlightOperation('reserved')).toBe(true);
    expect(isInFlightOperation('resetting')).toBe(true);
    expect(isTerminalOperation('completed')).toBe(true);
    expect(isTerminalOperation('failed')).toBe(true);
  });

  it('throws on an illegal transition', () => {
    expect(() => assertRecoveryOperationTransition('completed', 'resetting')).toThrow(
      RecoveryError,
    );
    expect(() => assertRecoveryOperationTransition('reserved', 'resetting')).not.toThrow();
  });
});
