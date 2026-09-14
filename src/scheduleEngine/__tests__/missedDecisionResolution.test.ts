import { describe, expect, it } from 'vitest';

import {
  classifyMissResolutionOutcome,
  missedDecisionIdentity,
  sameMissedDecision,
} from '../missedDecisionResolution';
import type { MissedSessionDecisionIdentity, ScheduleResolution } from '../types';

const expected: MissedSessionDecisionIdentity = {
  missedSessionIndex: 1,
  calendarSessionIndex: 2,
  missedScheduledDate: '2026-09-07',
};

const samePending: ScheduleResolution = {
  status: 'MISSED_SESSION_DECISION_REQUIRED',
  ...expected,
};

function firebaseError(code: string, message: string) {
  return { code, message };
}

describe('missed-decision canonical reconciliation', () => {
  it('normal success advances with the reloaded canonical SESSION_READY', () => {
    expect(classifyMissResolutionOutcome({
      error: null,
      expected,
      resolution: { status: 'SESSION_READY', sessionIndex: 1 },
    })).toEqual({ status: 'APPLIED', resolution: { status: 'SESSION_READY', sessionIndex: 1 } });
  });

  it('already-resolved no-pending + SESSION_READY is reconciliation, not a false error', () => {
    expect(classifyMissResolutionOutcome({
      error: firebaseError('functions/failed-precondition', 'no_pending_missed_session_decision'),
      expected,
      resolution: { status: 'SESSION_READY', sessionIndex: 1 },
    }).status).toBe('RECONCILED');
  });

  it('stale modal + a new pending identity reconciles to the new decision', () => {
    const replacement: ScheduleResolution = {
      status: 'MISSED_SESSION_DECISION_REQUIRED',
      missedSessionIndex: 2,
      calendarSessionIndex: 0,
      missedScheduledDate: '2026-09-10',
    };
    const outcome = classifyMissResolutionOutcome({
      error: firebaseError('functions/aborted', 'stale_missed_session_decision'),
      expected,
      resolution: replacement,
    });
    expect(outcome).toEqual({ status: 'RECONCILED', resolution: replacement });
    expect(sameMissedDecision(expected, missedDecisionIdentity(replacement))).toBe(false);
  });

  it('does not mask no-pending when the exact same decision remains canonical', () => {
    expect(classifyMissResolutionOutcome({
      error: firebaseError('functions/failed-precondition', 'no_pending_missed_session_decision'),
      expected,
      resolution: samePending,
    }).status).toBe('FAILED');
  });

  it('reconciles the exact local stale-identity guard only after canonical state changed', () => {
    expect(classifyMissResolutionOutcome({
      error: new Error('STALE_MISSED_SESSION_DECISION'),
      expected,
      resolution: { status: 'SESSION_READY', sessionIndex: 1 },
    }).status).toBe('RECONCILED');
    expect(classifyMissResolutionOutcome({
      error: new Error('SOME_OTHER_LOCAL_ERROR'),
      expected,
      resolution: { status: 'SESSION_READY', sessionIndex: 1 },
    }).status).toBe('FAILED');
  });

  it.each([
    firebaseError('functions/unavailable', 'network unavailable'),
    firebaseError('functions/failed-precondition', 'schedule_not_configured'),
    firebaseError('functions/failed-precondition', 'another_reason'),
  ])('keeps real network/backend failures retryable: %o', (error) => {
    expect(classifyMissResolutionOutcome({ error, expected, resolution: samePending }).status).toBe('FAILED');
  });

  it('cannot call a successful mutation reconciled when the authoritative reload failed', () => {
    expect(classifyMissResolutionOutcome({ error: null, expected, resolution: null }).status).toBe('FAILED');
  });
});
