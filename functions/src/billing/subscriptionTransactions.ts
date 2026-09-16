import * as crypto from 'crypto';
import { DocumentSnapshot, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/firebaseAdmin';
import { logInfo } from '../lib/logger';
import { resolveSubscriptionPlan } from '../adminUsers/presentation';
import { maskRevenueCatIdentifier } from './revenueCatIdentity';

const SCOPE = 'billing:subscriptionTransactions';

export const SUBSCRIPTION_TRANSACTIONS_COLLECTION = 'subscriptionTransactions';

export type FinancialMovementType = 'sale' | 'refund' | 'refund_reversal';
export type AttributionStatus = 'resolved' | 'unresolved';

export interface FinancialWebhookEvent {
  id?: unknown;
  type?: unknown;
  transaction_id?: unknown;
  original_transaction_id?: unknown;
  purchased_at_ms?: unknown;
  event_timestamp_ms?: unknown;
  period_type?: unknown;
  product_id?: unknown;
  store?: unknown;
  environment?: unknown;
  currency?: unknown;
  price?: unknown;
  price_in_purchased_currency?: unknown;
  tax_percentage?: unknown;
  commission_percentage?: unknown;
  takehome_percentage?: unknown;
  cancel_reason?: unknown;
}

interface NormalizedFinancialMovement {
  eventId: string;
  eventType: 'INITIAL_PURCHASE' | 'RENEWAL' | 'CANCELLATION' | 'REFUND_REVERSED';
  movementType: FinancialMovementType;
  transactionId: string;
  originalTransactionId: string;
  purchasedAt: Timestamp;
  eventTimestampMs: number;
  productId: string;
  plan: 'monthly' | 'annual' | 'unknown';
  store: string;
  environment: string | null;
  currency: string | null;
  grossRevenue: number | null;
  grossRevenueUsd: number | null;
  taxPercentage: number | null;
  storeCommissionPercentage: number | null;
  takehomePercentage: number | null;
  estimatedProceeds: number | null;
  subscriptionOriginTransactionKey: string;
  relatedSaleDocumentId: string | null;
  cancelReason: string | null;
}

export type FinancialEventNormalization =
  | { status: 'not_paid_event' }
  | { status: 'invalid_financial_event'; reason: string }
  | { status: 'valid'; data: NormalizedFinancialMovement };

const PAID_INITIAL_PERIODS = new Set(['NORMAL', 'INTRO', 'PREPAID']);

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function saleTransactionDocumentId(store: string, transactionId: string): string {
  return crypto.createHash('sha256').update(`${store}:${transactionId}`).digest('hex');
}

export function adjustmentTransactionDocumentId(eventId: string): string {
  return crypto.createHash('sha256').update(`revenuecat-event:${eventId}`).digest('hex');
}

function signedAmount(value: unknown, movementType: FinancialMovementType): number | null {
  const amount = finiteNumber(value);
  if (amount === null) return null;
  if (movementType === 'refund') return amount <= 0 ? amount : null;
  return amount >= 0 ? amount : null;
}

function estimatedProceeds(
  grossRevenue: number | null,
  taxPercentage: number | null,
  storeCommissionPercentage: number | null,
): number | null {
  if (grossRevenue === null || taxPercentage === null || storeCommissionPercentage === null) return null;
  const result = grossRevenue * (1 - taxPercentage - storeCommissionPercentage);
  return Number.isFinite(result) ? result : null;
}

/** Pure normalization. Missing optional financial values remain explicitly unknown. */
export function normalizeFinancialEvent(event: FinancialWebhookEvent): FinancialEventNormalization {
  let movementType: FinancialMovementType;
  if (event.type === 'INITIAL_PURCHASE') {
    if (!PAID_INITIAL_PERIODS.has(String(event.period_type))) return { status: 'not_paid_event' };
    movementType = 'sale';
  } else if (event.type === 'RENEWAL') {
    movementType = 'sale';
  } else if (event.type === 'CANCELLATION' && event.cancel_reason === 'CUSTOMER_SUPPORT') {
    movementType = 'refund';
  } else if (event.type === 'REFUND_REVERSED') {
    movementType = 'refund_reversal';
  } else {
    return { status: 'not_paid_event' };
  }

  const requiredStrings = ['id', 'transaction_id', 'original_transaction_id', 'product_id', 'store'] as const;
  for (const field of requiredStrings) {
    if (nonEmptyString(event[field]) === null) return { status: 'invalid_financial_event', reason: `missing_${field}` };
  }
  const purchasedAtMs = finiteNumber(event.purchased_at_ms);
  const eventTimestampMs = finiteNumber(event.event_timestamp_ms);
  if (purchasedAtMs === null || purchasedAtMs <= 0) return { status: 'invalid_financial_event', reason: 'missing_purchased_at_ms' };
  if (eventTimestampMs === null || eventTimestampMs <= 0) return { status: 'invalid_financial_event', reason: 'missing_event_timestamp_ms' };

  const store = event.store as string;
  const transactionId = event.transaction_id as string;
  const originalTransactionId = event.original_transaction_id as string;
  const grossRevenue = signedAmount(event.price_in_purchased_currency, movementType);
  const grossRevenueUsd = signedAmount(event.price, movementType);
  const taxPercentage = finiteNumber(event.tax_percentage);
  const storeCommissionPercentage = finiteNumber(event.commission_percentage);
  const isAdjustment = movementType !== 'sale';

  return { status: 'valid', data: {
    eventId: event.id as string,
    eventType: event.type as NormalizedFinancialMovement['eventType'],
    movementType,
    transactionId,
    originalTransactionId,
    purchasedAt: Timestamp.fromMillis(purchasedAtMs),
    eventTimestampMs,
    productId: event.product_id as string,
    plan: resolveSubscriptionPlan(event.product_id),
    store,
    environment: nonEmptyString(event.environment),
    currency: nonEmptyString(event.currency)?.toUpperCase() ?? null,
    grossRevenue,
    grossRevenueUsd,
    taxPercentage,
    storeCommissionPercentage,
    takehomePercentage: finiteNumber(event.takehome_percentage),
    estimatedProceeds: estimatedProceeds(grossRevenue, taxPercentage, storeCommissionPercentage),
    subscriptionOriginTransactionKey: `${store}:${originalTransactionId}`,
    relatedSaleDocumentId: isAdjustment ? saleTransactionDocumentId(store, transactionId) : null,
    cancelReason: nonEmptyString(event.cancel_reason),
  } };
}

function originMap(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasAttribution(data: Record<string, unknown>): boolean {
  return typeof data.couponCode === 'string'
    && typeof data.influencerId === 'string'
    && typeof data.campaignId === 'string';
}

async function findAttributionOrigin(
  currentUid: string,
  store: string,
  originalTransactionId: string,
  relatedSaleDocumentId: string | null,
): Promise<DocumentSnapshot | null> {
  const transactionKey = `${store}:${originalTransactionId}`;
  const current = await db.collection('couponRedemptions').doc(currentUid).get();
  const currentOrigin = originMap(current.get('subscriptionOrigin'));
  if (current.exists && currentOrigin.transactionKey === transactionKey && hasAttribution(current.data() ?? {})) return current;

  const matches = await db.collection('couponRedemptions')
    .where('subscriptionOrigin.transactionKey', '==', transactionKey)
    .limit(2)
    .get();
  if (matches.size === 1 && hasAttribution(matches.docs[0].data())) return matches.docs[0];

  if (relatedSaleDocumentId) {
    const sale = await db.collection(SUBSCRIPTION_TRANSACTIONS_COLLECTION).doc(relatedSaleDocumentId).get();
    const saleData = sale.data() ?? {};
    if (sale.exists && hasAttribution(saleData) && typeof saleData.attributionUid === 'string') return sale;
  }
  return null;
}

export type PersistFinancialTransactionResult =
  | 'recorded'
  | 'duplicate'
  | 'not_paid_event'
  | 'invalid_financial_event';

/**
 * Persists one immutable ledger movement. Firestore create plus deterministic
 * IDs make retries idempotent.
 *
 * A `sale` with no resolvable attribution origin is still recorded — the
 * ledger's job is to reflect every paid movement, and attribution is metadata
 * on top of that, not a precondition for the movement to exist (matches how
 * `refund`/`refund_reversal` already behave with `attributionStatus:
 * 'unresolved'`). See docs/13 §Passo 8.2.1.2 and the 8.4.3.1 audit.
 */
export async function persistAttributedFinancialTransaction(
  currentOwnerUid: string,
  rawEvent: FinancialWebhookEvent,
): Promise<PersistFinancialTransactionResult> {
  const normalized = normalizeFinancialEvent(rawEvent);
  if (normalized.status !== 'valid') return normalized.status;

  const data = normalized.data;
  const origin = await findAttributionOrigin(
    currentOwnerUid,
    data.store,
    data.originalTransactionId,
    data.relatedSaleDocumentId,
  );

  const attribution = origin?.data() ?? {};
  const attributionStatus: AttributionStatus = origin ? 'resolved' : 'unresolved';
  const attributionUid = origin
    ? (typeof attribution.attributionUid === 'string' ? attribution.attributionUid : origin.id)
    : null;
  const documentId = data.movementType === 'sale'
    ? saleTransactionDocumentId(data.store, data.transactionId)
    : adjustmentTransactionDocumentId(data.eventId);
  const ref = db.collection(SUBSCRIPTION_TRANSACTIONS_COLLECTION).doc(documentId);

  const result = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) return 'duplicate' as const;
    transaction.create(ref, {
      ...data,
      attributionStatus,
      attributionUid,
      currentOwnerUid,
      couponCode: origin ? attribution.couponCode : null,
      influencerId: origin ? attribution.influencerId : null,
      campaignId: origin ? attribution.campaignId : null,
      commissionEligible: null,
      commissionRuleId: null,
      commissionAmount: null,
      recordedAt: FieldValue.serverTimestamp(),
    });
    return 'recorded' as const;
  });

  if (result === 'recorded' && attributionStatus === 'unresolved') {
    logInfo(SCOPE, 'sale_recorded_without_attribution', {
      eventId: data.eventId,
      eventType: data.eventType,
      movementType: data.movementType,
      uid: maskRevenueCatIdentifier(currentOwnerUid),
    });
  }

  return result;
}
