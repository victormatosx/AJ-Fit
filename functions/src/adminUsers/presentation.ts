import { Timestamp } from 'firebase-admin/firestore';

export type AdminSubscriptionPlan = 'monthly' | 'annual' | 'unknown';

const MONTHLY_PRODUCT_IDS = new Set([
  'ajfit_premium_monthly',
  'ajfit_premium_monthly_promo',
  'ajfit_premium:monthly',
]);

const ANNUAL_PRODUCT_IDS = new Set([
  'ajfit_premium_annual',
  'ajfit_premium_annual_promo',
  'ajfit_premium:annual',
]);

export function resolveSubscriptionPlan(productId: unknown): AdminSubscriptionPlan {
  if (typeof productId !== 'string') return 'unknown';
  if (MONTHLY_PRODUCT_IDS.has(productId)) return 'monthly';
  if (ANNUAL_PRODUCT_IDS.has(productId)) return 'annual';
  return 'unknown';
}

export function isoDate(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

export function epochDate(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function safeBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
