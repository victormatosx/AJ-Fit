import { describe, expect, it } from 'vitest';

import { decideRecoveryOperation } from '../idempotency';
import type { RecoveryOperation } from '../schema';
import type { RecoveryOperationState } from '../stateMachine';

const CODE_ID = 'code-3';
const OTHER_CODE_ID = 'code-7';
const OPERATION_ID = 'op-aaaaaaaa';
const OTHER_OPERATION_ID = 'op-bbbbbbbb';

function operation(
  state: RecoveryOperationState,
  overrides: Partial<RecoveryOperation> = {},
): RecoveryOperation {
  return {
    operationId: OPERATION_ID,
    state,
    codeId: CODE_ID,
    createdAt: new Date('2026-08-19T10:00:00Z'),
    updatedAt: new Date('2026-08-19T10:00:00Z'),
    internalCode: null,
    ...overrides,
  };
}

describe('idempotency — no operation in flight', () => {
  it('starts a fresh operation when the slot is empty', () => {
    expect(
      decideRecoveryOperation({
        activeOperation: null,
        incomingOperationId: null,
        codeId: CODE_ID,
      }),
    ).toEqual({ kind: 'start' });
  });

  it('ignores an operationId that matches nothing', () => {
    // The slot is the only source of truth: an unknown id must not be able to
    // resurrect a reservation that no longer exists.
    expect(
      decideRecoveryOperation({
        activeOperation: null,
        incomingOperationId: OPERATION_ID,
        codeId: CODE_ID,
      }),
    ).toEqual({ kind: 'start' });
  });
});

describe('idempotency — retry of the same operation', () => {
  it.each(['reserved', 'resetting'] as const)(
    'resumes an in-flight operation in state %s',
    (state) => {
      const active = operation(state);

      expect(
        decideRecoveryOperation({
          activeOperation: active,
          incomingOperationId: OPERATION_ID,
          codeId: CODE_ID,
        }),
      ).toEqual({ kind: 'resume', operation: active });
    },
  );

  it('replays success without consuming another code', () => {
    const active = operation('completed');

    expect(
      decideRecoveryOperation({
        activeOperation: active,
        incomingOperationId: OPERATION_ID,
        codeId: CODE_ID,
      }),
    ).toEqual({ kind: 'alreadyCompleted', operation: active });
  });

  it('does not let a retry convert a terminal failure into a new attempt', () => {
    const active = operation('failed', { internalCode: 'RECOVERY_SET_NOT_ACTIVE' });

    expect(
      decideRecoveryOperation({
        activeOperation: active,
        incomingOperationId: OPERATION_ID,
        codeId: CODE_ID,
      }),
    ).toEqual({ kind: 'terminalFailure', operation: active });
  });

  it('is stable across repeated retries', () => {
    const active = operation('resetting');
    const input = {
      activeOperation: active,
      incomingOperationId: OPERATION_ID,
      codeId: CODE_ID,
    };

    expect(decideRecoveryOperation(input)).toEqual(decideRecoveryOperation(input));
  });
});

describe('idempotency — an operationId is bound to exactly one code', () => {
  it.each(['reserved', 'resetting', 'completed', 'failed'] as const)(
    'refuses to re-point operation state %s at a different code',
    (state) => {
      expect(
        decideRecoveryOperation({
          activeOperation: operation(state),
          incomingOperationId: OPERATION_ID,
          codeId: OTHER_CODE_ID,
        }),
      ).toEqual({ kind: 'conflict', internalCode: 'OPERATION_CONFLICT' });
    },
  );
});

describe('idempotency — a different operationId never adopts an existing reservation', () => {
  it.each(['reserved', 'resetting'] as const)(
    'conflicts when another operation is still in flight (%s) on the same code',
    (state) => {
      expect(
        decideRecoveryOperation({
          activeOperation: operation(state),
          incomingOperationId: OTHER_OPERATION_ID,
          codeId: CODE_ID,
        }),
      ).toEqual({ kind: 'conflict', internalCode: 'CODE_ALREADY_RESERVED' });
    },
  );

  it.each(['reserved', 'resetting'] as const)(
    'conflicts when another operation is still in flight (%s) on a different code',
    (state) => {
      // One reset at a time, always — a second would race the Admin SDK call.
      expect(
        decideRecoveryOperation({
          activeOperation: operation(state),
          incomingOperationId: OTHER_OPERATION_ID,
          codeId: OTHER_CODE_ID,
        }),
      ).toEqual({ kind: 'conflict', internalCode: 'OPERATION_CONFLICT' });
    },
  );

  it('conflicts when no operationId is presented at all but one is in flight', () => {
    expect(
      decideRecoveryOperation({
        activeOperation: operation('resetting'),
        incomingOperationId: null,
        codeId: CODE_ID,
      }),
    ).toEqual({ kind: 'conflict', internalCode: 'CODE_ALREADY_RESERVED' });
  });
});

describe('idempotency — a finished operation frees the slot', () => {
  it.each(['completed', 'failed'] as const)(
    'lets a new operation start after a %s one, on a different code',
    (state) => {
      expect(
        decideRecoveryOperation({
          activeOperation: operation(state),
          incomingOperationId: OTHER_OPERATION_ID,
          codeId: OTHER_CODE_ID,
        }),
      ).toEqual({ kind: 'start' });
    },
  );

  it('lets a new operation start after a finished one when no id is presented', () => {
    expect(
      decideRecoveryOperation({
        activeOperation: operation('completed'),
        incomingOperationId: null,
        codeId: OTHER_CODE_ID,
      }),
    ).toEqual({ kind: 'start' });
  });
});

describe('idempotency — the decision never releases a reservation', () => {
  it('has no outcome that returns a code to available', () => {
    const decisions = (['reserved', 'resetting', 'completed', 'failed'] as const).flatMap(
      (state) =>
        [OPERATION_ID, OTHER_OPERATION_ID, null].flatMap((incoming) =>
          [CODE_ID, OTHER_CODE_ID].map((codeId) =>
            decideRecoveryOperation({
              activeOperation: operation(state),
              incomingOperationId: incoming,
              codeId,
            }),
          ),
        ),
    );

    const kinds = new Set(decisions.map((decision) => decision.kind));

    expect(kinds).not.toContain('release');
    for (const kind of kinds) {
      expect(['start', 'resume', 'alreadyCompleted', 'terminalFailure', 'conflict']).toContain(
        kind,
      );
    }
  });
});
