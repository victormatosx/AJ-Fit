import {
  PROMO_CODE_MAX_LENGTH,
  PROMO_CODE_MAX_RAW_INPUT_LENGTH,
  PROMO_CODE_PATTERN,
} from './constants';

/**
 * The single normalization routine for promo/influencer codes. Every reader
 * or writer of `promoCodes/{code}` — this validation module today, any
 * future admin tooling — MUST call this rather than re-deriving the
 * transform inline, so the document ID a code maps to is never ambiguous.
 *
 * Returns `null` for anything that isn't a clean, in-bounds, allowlisted
 * code — never throws, so callers can turn `null` straight into a generic
 * "invalid code" response without a try/catch.
 */
export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  // Reject before any processing: bounds the cost of handling adversarial
  // input and makes the "excessively long" rule independent of where
  // whitespace sits in the raw string.
  if (raw.length === 0 || raw.length > PROMO_CODE_MAX_RAW_INPUT_LENGTH) return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > PROMO_CODE_MAX_LENGTH) return null;

  const normalized = trimmed.toUpperCase();

  // Strict allowlist — the actual gatekeeper against internal spaces, `/`,
  // and any invisible/zero-width/confusable Unicode character. trim() only
  // strips whitespace at the ends; this regex is what makes those other
  // categories fail regardless of what trim()/toUpperCase() did to them.
  return PROMO_CODE_PATTERN.test(normalized) ? normalized : null;
}
