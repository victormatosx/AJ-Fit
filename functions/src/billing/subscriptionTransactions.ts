import * as crypto from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/firebaseAdmin';
import { resolveSubscriptionPlan } from '../adminUsers/presentation';

export const SUBSCRIPTION_TRANSACTIONS_COLLECTION = 'subscriptionTransactions';

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
}

export type FinancialEventNormalization =
  | { status: 'not_paid_event' }
  | { status: 'invalid_financial_event'; reason: string }
  | { status: 'valid'; data: {
      eventId: string; eventType: 'INITIAL_PURCHASE' | 'RENEWAL'; transactionId: string;
      originalTransactionId: string; purchasedAt: Timestamp; eventTimestampMs: number;
      productId: string; plan: 'monthly' | 'annual' | 'unknown'; store: string;
      environment: string | null; currency: string; grossRevenue: number; grossRevenueUsd: number | null;
      taxPercentage: number | null; storeCommissionPercentage: number | null; takehomePercentage: number | null;
    } };

const PAID_INITIAL_PERIODS = new Set(['NORMAL', 'INTRO', 'PREPAID']);

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Pure, fail-closed normalization. Trial and promotional grants are never sales. */
export function normalizeFinancialEvent(event: FinancialWebhookEvent): FinancialEventNormalization {
  if (event.type !== 'INITIAL_PURCHASE' && event.type !== 'RENEWAL') return { status: 'not_paid_event' };
  if (event.type === 'INITIAL_PURCHASE' && !PAID_INITIAL_PERIODS.has(String(event.period_type))) return { status: 'not_paid_event' };
  const requiredStrings = ['id', 'transaction_id', 'original_transaction_id', 'product_id', 'store', 'currency'] as const;
  for (const field of requiredStrings) if (typeof event[field] !== 'string' || !event[field].trim()) return { status: 'invalid_financial_event', reason: `missing_${field}` };
  const purchasedAtMs = finiteNumber(event.purchased_at_ms);
  const eventTimestampMs = finiteNumber(event.event_timestamp_ms);
  const grossRevenue = finiteNumber(event.price_in_purchased_currency);
  if (purchasedAtMs === null || purchasedAtMs <= 0) return { status: 'invalid_financial_event', reason: 'missing_purchased_at_ms' };
  if (eventTimestampMs === null || eventTimestampMs <= 0) return { status: 'invalid_financial_event', reason: 'missing_event_timestamp_ms' };
  if (grossRevenue === null) return { status: 'invalid_financial_event', reason: 'missing_price_in_purchased_currency' };
  return { status: 'valid', data: {
    eventId: event.id as string, eventType: event.type, transactionId: event.transaction_id as string,
    originalTransactionId: event.original_transaction_id as string, purchasedAt: Timestamp.fromMillis(purchasedAtMs),
    eventTimestampMs, productId: event.product_id as string, plan: resolveSubscriptionPlan(event.product_id),
    store: event.store as string, environment: typeof event.environment === 'string' ? event.environment : null,
    currency: (event.currency as string).toUpperCase(), grossRevenue,
    grossRevenueUsd: finiteNumber(event.price), taxPercentage: finiteNumber(event.tax_percentage),
    storeCommissionPercentage: finiteNumber(event.commission_percentage), takehomePercentage: finiteNumber(event.takehome_percentage),
  } };
}

function transactionDocumentId(store: string, transactionId: string): string {
  return crypto.createHash('sha256').update(`${store}:${transactionId}`).digest('hex');
}

function originMap(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function findAttributionOrigin(currentUid: string, store: string, originalTransactionId: string) {
  const transactionKey = `${store}:${originalTransactionId}`;
  const current = await db.collection('couponRedemptions').doc(currentUid).get();
  const currentOrigin = originMap(current.get('subscriptionOrigin'));
  if (current.exists && currentOrigin.transactionKey === transactionKey) return current;
  const matches = await db.collection('couponRedemptions').where('subscriptionOrigin.transactionKey', '==', transactionKey).limit(2).get();
  return matches.size === 1 ? matches.docs[0] : null;
}

export type PersistFinancialTransactionResult = 'recorded' | 'duplicate' | 'not_paid_event' | 'invalid_financial_event' | 'unattributed';

/**
 * Persists one immutable paid transaction. The document id is a hash of the store transaction id,
 * so webhook retries and restore flows cannot create a second sale. Attribution is resolved by the
 * immutable original transaction identity, not by current ownership or temporal proximity.
 */
export async function persistAttributedFinancialTransaction(
  currentOwnerUid: string,
  rawEvent: FinancialWebhookEvent,
): Promise<PersistFinancialTransactionResult> {
  const normalized = normalizeFinancialEvent(rawEvent);
  if (normalized.status !== 'valid') return normalized.status;
  const origin = await findAttributionOrigin(currentOwnerUid, normalized.data.store, normalized.data.originalTransactionId);
  if (!origin) return 'unattributed';
  const redemption = origin.data() ?? {};
  if (typeof redemption.couponCode !== 'string' || typeof redemption.influencerId !== 'string' || typeof redemption.campaignId !== 'string') return 'unattributed';
  const ref = db.collection(SUBSCRIPTION_TRANSACTIONS_COLLECTION).doc(transactionDocumentId(normalized.data.store, normalized.data.transactionId));
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) return 'duplicate';
    const proceeds = normalized.data.grossRevenue * (1 - (normalized.data.taxPercentage ?? 0) - (normalized.data.storeCommissionPercentage ?? 0));
    transaction.create(ref, {
      ...normalized.data,
      attributionUid: origin.id,
      currentOwnerUid,
      couponCode: redemption.couponCode,
      influencerId: redemption.influencerId,
      campaignId: redemption.campaignId,
      estimatedProceeds: Number.isFinite(proceeds) ? proceeds : null,
      commissionEligible: null,
      commissionRuleId: null,
      commissionAmount: null,
      recordedAt: FieldValue.serverTimestamp(),
    });
    return 'recorded';
  });
}
