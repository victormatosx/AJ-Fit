/**
 * Constants for the (not yet implemented) user-attribution / coupon module
 * (docs/13_assinaturas_e_billing.md §33, "Arquitetura de Atribuição de
 * Usuários"). Attribution/marketing data is a SEPARATE responsibility from
 * billing (docs §33) — this module intentionally has zero imports from
 * `../billing/*`, even where a value would be identical (e.g.
 * `USERS_COLLECTION`), to keep the two fully decoupled in code, not just in
 * documentation.
 *
 * Sprint 3.6 scope: constants + types only (see ./types.ts). No
 * read/write/validation logic yet — that lands in the sprint that actually
 * implements the coupon system.
 */

/** Firestore collection holding the user documents this module's mirror field lives on. */
export const USERS_COLLECTION = 'users';

/**
 * Nested map field on `users/{uid}` — the read-optimized MIRROR of a user's
 * attribution. Never the source of truth (docs §33) — that's
 * `COUPON_REDEMPTIONS_COLLECTION`.
 */
export const ATTRIBUTION_FIELD = 'attribution';

/**
 * Top-level, append-only collection: one immutable document per redemption
 * event. THE source of truth for attribution (docs §8/§24/§33) — same
 * "immutable event doc, never overwritten" shape as `questionnaires` and
 * `assessments` (docs/03).
 */
export const COUPON_REDEMPTIONS_COLLECTION = 'couponRedemptions';

/** Path helper so no other module hand-builds `users/${uid}` template strings. */
export function userDocPath(uid: string): string {
  return `${USERS_COLLECTION}/${uid}`;
}
