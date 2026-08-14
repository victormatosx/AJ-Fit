import { describe, expect, it } from 'vitest';
import { decideSubscriptionEventOutcome, type CurrentSubscriptionEventState } from '../subscriptionSync';
import { EARLIER_MS, LATER_MS, NOW_MS } from './fixtures';

/**
 * Unit tests for the PURE decision logic behind
 * `applySubscriptionEventAtomically` (subscriptionSync.ts, Sprint 4.1) —
 * CASES A–E from this Sprint's design (docs/13_assinaturas_e_billing.md §25).
 *
 * IMPORTANT LIMITATION (see functions/TESTING.md for the full explanation
 * and the Emulator-based roteiro): these tests validate the DECISION RULES
 * in isolation — they do NOT exercise real Firestore transactional
 * atomicity. Nothing here proves that two genuinely concurrent requests
 * against a real Firestore instance can't both observe the same "before"
 * state — that guarantee comes from Firestore's own transaction contention
 * handling, which only a real (emulated or live) Firestore can verify. This
 * environment has no Java 21, so the Firestore Emulator could not be run —
 * do not read "concurrency-safe" as validated by these tests alone.
 */

const NO_PREVIOUS_EVENT: CurrentSubscriptionEventState = {
  lastEventId: null,
  lastEventTimestampMs: null,
};

function withPrevious(lastEventId: string, lastEventTimestampMs: number): CurrentSubscriptionEventState {
  return { lastEventId, lastEventTimestampMs };
}

describe('decideSubscriptionEventOutcome', () => {
  it('CASE E: no previous event stored (pre-4.1 doc or first-ever event) → processed, no backfill needed', () => {
    const result = decideSubscriptionEventOutcome(NO_PREVIOUS_EVENT, 'evt_new', NOW_MS);
    expect(result).toEqual({ status: 'processed' });
  });

  it('CASE C: newer event than what is stored → processed', () => {
    const current = withPrevious('evt_old', EARLIER_MS);
    const result = decideSubscriptionEventOutcome(current, 'evt_new', NOW_MS);
    expect(result).toEqual({ status: 'processed' });
  });

  it('CASE A: same event.id already applied → duplicate, regardless of timestamp', () => {
    const current = withPrevious('evt_1', NOW_MS);
    const result = decideSubscriptionEventOutcome(current, 'evt_1', NOW_MS);
    expect(result).toEqual({ status: 'duplicate' });
  });

  it('CASE A takes priority even if a "duplicate" retry claims an (impossible) different timestamp', () => {
    const current = withPrevious('evt_1', NOW_MS);
    const result = decideSubscriptionEventOutcome(current, 'evt_1', LATER_MS);
    expect(result).toEqual({ status: 'duplicate' });
  });

  it('CASE B: older event (different id) arriving after a newer one was applied → stale, no write', () => {
    const current = withPrevious('evt_renewal', NOW_MS);
    const result = decideSubscriptionEventOutcome(current, 'evt_old_cancellation', EARLIER_MS);
    expect(result).toEqual({ status: 'stale' });
  });

  it('CASE D: same timestamp, different id → conflict, no write, no arbitrary tie-break', () => {
    const current = withPrevious('evt_a', NOW_MS);
    const result = decideSubscriptionEventOutcome(current, 'evt_b', NOW_MS);
    expect(result).toEqual({ status: 'conflict' });
  });

  it('two simultaneous retries of the same event both decide duplicate on the second read (sequential simulation)', () => {
    // Not a concurrency test (see file header) — simulates the SEQUENCE of
    // decisions two retries would produce if evaluated one after another
    // against the state left by the first.
    const initial = NO_PREVIOUS_EVENT;
    const firstDecision = decideSubscriptionEventOutcome(initial, 'evt_retry', NOW_MS);
    expect(firstDecision).toEqual({ status: 'processed' });

    const stateAfterFirstWrite = withPrevious('evt_retry', NOW_MS);
    const secondDecision = decideSubscriptionEventOutcome(stateAfterFirstWrite, 'evt_retry', NOW_MS);
    expect(secondDecision).toEqual({ status: 'duplicate' });
  });

  it('RENEWAL applied after CANCELLATION (newer timestamp) is processed, not blocked', () => {
    const stateAfterCancellation = withPrevious('evt_cancellation', EARLIER_MS);
    const result = decideSubscriptionEventOutcome(stateAfterCancellation, 'evt_renewal', NOW_MS);
    expect(result).toEqual({ status: 'processed' });
  });

  it('CANCELLATION older than an already-applied RENEWAL is rejected as stale (does not overwrite the renewal)', () => {
    const stateAfterRenewal = withPrevious('evt_renewal', NOW_MS);
    const result = decideSubscriptionEventOutcome(stateAfterRenewal, 'evt_old_cancellation', EARLIER_MS);
    expect(result).toEqual({ status: 'stale' });
  });

  it('PRODUCT_CHANGE older than the current state is rejected as stale', () => {
    const stateAfterNewerEvent = withPrevious('evt_current', NOW_MS);
    const result = decideSubscriptionEventOutcome(stateAfterNewerEvent, 'evt_old_product_change', EARLIER_MS);
    expect(result).toEqual({ status: 'stale' });
  });

  it('a newer BILLING_ISSUE is processed normally even with a prior stored event', () => {
    const stateAfterEarlierEvent = withPrevious('evt_earlier', EARLIER_MS);
    const result = decideSubscriptionEventOutcome(stateAfterEarlierEvent, 'evt_billing_issue', NOW_MS);
    expect(result).toEqual({ status: 'processed' });
  });
});
