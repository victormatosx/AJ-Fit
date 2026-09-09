import { describe, expect, it } from 'vitest';

import {
  pendingMissMatchesGap,
  reconcilePendingMissDecision,
} from '../pendingMissReconciliation';
import type { PendingMissDecision } from '../types';

const pending: PendingMissDecision = {
  missedSessionIndex: 1,
  calendarSessionIndex: 2,
  missedScheduledDate: '2026-09-07',
  detectedOnDate: '2026-09-09',
};

describe('pending miss reconciliation', () => {
  it('keeps a pending decision that still represents the current gap', () => {
    const gap = {
      missedSessionIndex: 1,
      calendarSessionIndex: 2,
      missedScheduledDate: '2026-09-07',
    };
    expect(pendingMissMatchesGap(pending, gap)).toBe(true);
    expect(reconcilePendingMissDecision(pending, gap, '2026-09-09')).toBe(pending);
  });

  it('clears a pending decision when the authoritative calendar no longer has a gap', () => {
    expect(pendingMissMatchesGap(pending, null)).toBe(false);
    expect(reconcilePendingMissDecision(pending, null, '2026-09-09')).toBeNull();
  });

  it('replaces stale coordinates when the current gap changed', () => {
    expect(reconcilePendingMissDecision(pending, {
      missedSessionIndex: 2,
      calendarSessionIndex: 0,
      missedScheduledDate: '2026-09-08',
    }, '2026-09-10')).toEqual({
      missedSessionIndex: 2,
      calendarSessionIndex: 0,
      missedScheduledDate: '2026-09-08',
      detectedOnDate: '2026-09-10',
    });
  });
});
