import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { extractEventTimestampMs, normalizeSubscription } from '../revenuecat';
import {
  billingIssueEvent,
  cancellationDuringTrialEvent,
  cancellationRefundEvent,
  cancellationVoluntaryEvent,
  expirationEvent,
  initialPurchaseEvent,
  invalidTimestampEvent,
  missingTimestampEvent,
  productChangeEvent,
  productChangeWithoutNewProductIdEvent,
  renewalEvent,
} from './fixtures';

describe('normalizeSubscription', () => {
  it('INITIAL_PURCHASE: TRIAL status, entitlementActive=true, startedAt set', () => {
    const result = normalizeSubscription(
      initialPurchaseEvent,
      'INITIAL_PURCHASE',
      initialPurchaseEvent.event_timestamp_ms,
    );

    expect(result.status).toBe('TRIAL');
    expect(result.entitlementActive).toBe(true);
    expect(result.provider).toBe('REVENUECAT');
    expect(result.productId).toBe('ajfit_premium_monthly');
    expect(result.store).toBe('APP_STORE');
    expect(result.startedAt).toBeInstanceOf(Timestamp);
    expect(result.trialEndsAt).toBeInstanceOf(Timestamp);
    expect(result.currentPeriodEndsAt).toBeInstanceOf(Timestamp);
    // Not a renewal — must not be set at all.
    expect(result.lastRenewedAt).toBeUndefined();
    // A fresh purchase clears any leftover cancellation from a prior cycle
    // (robustness-audit fix, Sprint 4) — explicitly null, not just absent.
    expect(result.canceledAt).toBeNull();
  });

  it('never sets lastEventId or lastEventTimestampMs (Sprint 4.1: exclusively set by applySubscriptionEventAtomically)', () => {
    const result = normalizeSubscription(
      initialPurchaseEvent,
      'INITIAL_PURCHASE',
      initialPurchaseEvent.event_timestamp_ms,
    );
    expect('lastEventId' in result).toBe(false);
    expect('lastEventTimestampMs' in result).toBe(false);
  });

  it('RENEWAL: ACTIVE status, entitlementActive=true, lastRenewedAt set, startedAt omitted', () => {
    const result = normalizeSubscription(renewalEvent, 'RENEWAL', renewalEvent.event_timestamp_ms);

    expect(result.status).toBe('ACTIVE');
    expect(result.entitlementActive).toBe(true);
    expect(result.lastRenewedAt).toBeInstanceOf(Timestamp);
    // Critical: purchased_at_ms moves every renewal, so `startedAt` must
    // NEVER be written on a RENEWAL — only on INITIAL_PURCHASE.
    expect(result.startedAt).toBeUndefined();
    expect(result.trialEndsAt).toBeUndefined(); // period_type is NORMAL, not TRIAL
    // Robustness-audit fix, Sprint 4: a successful renewal clears any stale
    // canceledAt from a previous cancel-then-renew cycle.
    expect(result.canceledAt).toBeNull();
  });

  it('CANCELLATION (voluntary, still within paid period): CANCELED status but entitlementActive stays true', () => {
    const result = normalizeSubscription(
      cancellationVoluntaryEvent,
      'CANCELLATION',
      cancellationVoluntaryEvent.event_timestamp_ms,
    );

    expect(result.status).toBe('CANCELED');
    // The central rule of docs §10/§11: CANCELED does not mean revoked.
    expect(result.entitlementActive).toBe(true);
    expect(result.canceledAt).toBeInstanceOf(Timestamp);
    expect(result.currentPeriodEndsAt).toBeInstanceOf(Timestamp);
  });

  it('CANCELLATION during trial: entitlementActive stays true until the trial period actually ends (docs §15)', () => {
    const result = normalizeSubscription(
      cancellationDuringTrialEvent,
      'CANCELLATION',
      cancellationDuringTrialEvent.event_timestamp_ms,
    );

    expect(result.status).toBe('CANCELED');
    expect(result.entitlementActive).toBe(true);
    expect(result.currentPeriodEndsAt).toBeInstanceOf(Timestamp);
  });

  it('CANCELLATION (refund — the ex-"REFUND" scenario): entitlementActive becomes false once expiration_at_ms is in the past', () => {
    const result = normalizeSubscription(
      cancellationRefundEvent,
      'CANCELLATION',
      cancellationRefundEvent.event_timestamp_ms,
    );

    expect(result.status).toBe('CANCELED');
    expect(result.entitlementActive).toBe(false);
  });

  it('EXPIRATION: EXPIRED status, entitlementActive=false even if a timestamp edge case existed', () => {
    const result = normalizeSubscription(
      expirationEvent,
      'EXPIRATION',
      expirationEvent.event_timestamp_ms,
    );

    expect(result.status).toBe('EXPIRED');
    expect(result.entitlementActive).toBe(false);
  });

  it('BILLING_ISSUE: status BILLING_ISSUE, entitlementActive stays true during the grace period', () => {
    const result = normalizeSubscription(
      billingIssueEvent,
      'BILLING_ISSUE',
      billingIssueEvent.event_timestamp_ms,
    );

    expect(result.status).toBe('BILLING_ISSUE');
    // expiration_at_ms is already in the past, but grace_period_expiration_at_ms
    // is in the future — docs §17: access continues during the grace period.
    expect(result.entitlementActive).toBe(true);
    expect(result.store).toBe('PLAY_STORE');
  });

  it('PRODUCT_CHANGE: uses new_product_id, not the old product_id', () => {
    const result = normalizeSubscription(
      productChangeEvent,
      'PRODUCT_CHANGE',
      productChangeEvent.event_timestamp_ms,
    );

    expect(result.status).toBe('ACTIVE');
    expect(result.productId).toBe('ajfit_premium_annual');
    expect(result.entitlementActive).toBe(true);
  });

  it('PRODUCT_CHANGE without new_product_id: falls back to product_id', () => {
    const result = normalizeSubscription(
      productChangeWithoutNewProductIdEvent,
      'PRODUCT_CHANGE',
      productChangeWithoutNewProductIdEvent.event_timestamp_ms,
    );

    expect(result.productId).toBe('ajfit_premium_monthly');
  });

  it('never includes updatedAt (set exclusively by the writer)', () => {
    const result = normalizeSubscription(renewalEvent, 'RENEWAL', renewalEvent.event_timestamp_ms);
    expect('updatedAt' in result).toBe(false);
  });

  it('logs a warning but still returns entitlementActive=false when entitlement_ids does not include "premium"', () => {
    const result = normalizeSubscription(
      { ...renewalEvent, entitlement_ids: ['some_other_entitlement'] },
      'RENEWAL',
      renewalEvent.event_timestamp_ms,
    );
    expect(result.entitlementActive).toBe(false);
  });

  it('entitlementActive is false (never inferred true) when entitlement_ids is absent entirely', () => {
    const { entitlement_ids: _omit, ...eventWithoutEntitlementIds } = renewalEvent;
    const result = normalizeSubscription(
      eventWithoutEntitlementIds,
      'RENEWAL',
      renewalEvent.event_timestamp_ms,
    );
    expect(result.entitlementActive).toBe(false);
  });
});

describe('extractEventTimestampMs', () => {
  it('returns the value for a valid positive integer', () => {
    expect(extractEventTimestampMs(renewalEvent)).toBe(renewalEvent.event_timestamp_ms);
  });

  it('returns null when event_timestamp_ms is missing', () => {
    expect(extractEventTimestampMs(missingTimestampEvent)).toBeNull();
  });

  it('returns null when event_timestamp_ms is not a positive integer', () => {
    expect(extractEventTimestampMs(invalidTimestampEvent)).toBeNull();
  });

  it('returns null for a non-integer number', () => {
    expect(extractEventTimestampMs({ ...renewalEvent, event_timestamp_ms: 123.45 })).toBeNull();
  });

  it('returns null for zero', () => {
    expect(extractEventTimestampMs({ ...renewalEvent, event_timestamp_ms: 0 })).toBeNull();
  });
});
