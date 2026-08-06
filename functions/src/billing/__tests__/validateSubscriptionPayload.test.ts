import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { normalizeSubscription } from '../revenuecat';
import { validateSubscriptionPayload } from '../subscriptionSync';
import { initialPurchaseEvent, renewalEvent } from './fixtures';

describe('validateSubscriptionPayload', () => {
  it('accepts a real normalizeSubscription() output (INITIAL_PURCHASE)', () => {
    const normalized = normalizeSubscription(
      initialPurchaseEvent,
      'INITIAL_PURCHASE',
      initialPurchaseEvent.event_timestamp_ms,
    );
    const result = validateSubscriptionPayload(normalized);
    expect(result.ok).toBe(true);
  });

  it('accepts a real normalizeSubscription() output (RENEWAL, fewer fields)', () => {
    const normalized = normalizeSubscription(
      renewalEvent,
      'RENEWAL',
      renewalEvent.event_timestamp_ms,
    );
    const result = validateSubscriptionPayload(normalized);
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown field', () => {
    const result = validateSubscriptionPayload({ status: 'ACTIVE', notAFieldInTheSchema: true });
    expect(result.ok).toBe(false);
  });

  it('rejects a caller-supplied updatedAt (must only be set by the writer)', () => {
    const result = validateSubscriptionPayload({ updatedAt: Timestamp.now() });
    expect(result.ok).toBe(false);
  });

  it('rejects a caller-supplied lastEventId (Sprint 4.1: exclusively set by applySubscriptionEventAtomically)', () => {
    const result = validateSubscriptionPayload({ lastEventId: 'evt_123' });
    expect(result.ok).toBe(false);
  });

  it('rejects a caller-supplied lastEventTimestampMs (Sprint 4.1: exclusively set by applySubscriptionEventAtomically)', () => {
    const result = validateSubscriptionPayload({ lastEventTimestampMs: 123 });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid status value', () => {
    const result = validateSubscriptionPayload({ status: 'NOT_A_REAL_STATUS' });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-Timestamp for a Timestamp field', () => {
    const result = validateSubscriptionPayload({ startedAt: '2026-01-01' });
    expect(result.ok).toBe(false);
  });

  it('accepts null for a nullable Timestamp field', () => {
    const result = validateSubscriptionPayload({ currentPeriodEndsAt: null });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object payload', () => {
    expect(validateSubscriptionPayload('not an object').ok).toBe(false);
    expect(validateSubscriptionPayload(null).ok).toBe(false);
    expect(validateSubscriptionPayload([1, 2, 3]).ok).toBe(false);
  });

  it('accepts an empty object (all fields optional)', () => {
    expect(validateSubscriptionPayload({}).ok).toBe(true);
  });
});
