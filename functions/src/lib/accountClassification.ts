/**
 * The account-identity axis: is this `users/{uid}` a real user or an
 * internal QA/test account? This is a THIRD, independent axis from:
 *
 *   - `RevenueCatWebhookEnvironment` (billing/financialEnvironment.ts) —
 *     authority: RevenueCat, describes a financial TRANSACTION's origin.
 *   - `NotificationDispatchMode` (notifications/schema.ts) — authority:
 *     the backend dispatcher, describes one notification DISPATCH.
 *
 * None of the three is derived from another. An `INTERNAL_QA` account can
 * make a real `PRODUCTION` purchase (deliberately, to test the real
 * checkout path) or receive an ordinary `PRODUCT` notification — that is
 * expected, not a contradiction. See `__tests__/accountClassAxisIndependence.test.ts`.
 *
 * Storage: `users/{uid}.metadata.accountClass`. Deliberately NOT
 * `adminAccessGrants` — that collection means "administratively granted
 * free Premium," a different concept that happens to also be admin-only.
 *
 * Authority: this field is never client-writable (see `firestore.rules`'
 * `metadataValid`/`users/{userId}` `create`/`update` — the client's own
 * `diff().affectedKeys().hasOnly(['updatedAt'])` on `metadata` blocks any
 * post-creation change, and `create` explicitly rejects the key). Every new
 * account is stamped `PRODUCTION` by the `onUserProvisioned` trigger
 * (adminUsers/accountClassProvisioning.ts) immediately after the client
 * creates `users/{uid}` — never inferred from email, build profile, or any
 * other client-controlled signal. Only `adminSetAccountClass` (admin-only
 * callable) can move an account to `INTERNAL_QA` or back.
 *
 * ── Written vs. resolved (the bug this comment exists to prevent) ────────
 *
 * `AccountClass` is what may ever be WRITTEN — exactly two states, both
 * explicit. `ResolvedAccountClass` is what READING the field yields, and
 * has a THIRD state, `'UNKNOWN'`, for "not yet classified" (absent — the
 * `onUserProvisioned` trigger hasn't run yet, or never will) or
 * "malformed" (present but not a recognized value — can only mean a bug,
 * since the client can never write this field).
 *
 * `UNKNOWN` is NEVER `'PRODUCTION'`. This must hold in exactly the same way
 * for `resolveAccountClass` (used for single-document reads/display) AND
 * for `productionUsersQuery` (used for bulk/metric reads) — Firestore's
 * `where('field', '==', 'PRODUCTION')` already, correctly, excludes
 * documents where the field is absent. The bug this module previously had
 * was `resolveAccountClass(undefined) === 'PRODUCTION'` while
 * `productionUsersQuery` excluded that same document — two different
 * answers to "is this account PRODUCTION?" depending on which code path
 * asked. Fixed by making the resolver agree with what the query can
 * actually express: absence resolves to `UNKNOWN`, not `PRODUCTION`. See
 * `__tests__/accountClassification.test.ts`'s "resolver/query parity" test.
 */

import type { Firestore, Query } from 'firebase-admin/firestore';

export const ACCOUNT_CLASSES = ['PRODUCTION', 'INTERNAL_QA'] as const;
/** What may ever be WRITTEN to `metadata.accountClass` — never `'UNKNOWN'`, which is read-only. */
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];

export const RESOLVED_ACCOUNT_CLASSES = ['PRODUCTION', 'INTERNAL_QA', 'UNKNOWN'] as const;
/** What READING the field yields. */
export type ResolvedAccountClass = (typeof RESOLVED_ACCOUNT_CLASSES)[number];

export const USERS_COLLECTION = 'users';

/**
 * Resolves the raw Firestore value to a closed `ResolvedAccountClass`.
 *
 * Absence means "not yet classified" — the `onUserProvisioned` trigger
 * hasn't stamped this document yet (a normal, brief window right after
 * client-side creation), it failed permanently, or the document predates
 * the field. None of those is safe to treat as `PRODUCTION`: this function
 * and `productionUsersQuery` must agree on exactly which documents count
 * as production, and Firestore's equality filter can never match an absent
 * field — so neither can this resolver, on pain of exactly the
 * resolver/query divergence this module now guards against.
 *
 * A PRESENT-but-unrecognized value gets the SAME `UNKNOWN` answer, for the
 * same reason: it is not a value `productionUsersQuery` would match either,
 * and since the client can never write this field, it can only mean a bug
 * or a manual edit — never silently treated as either explicit state.
 */
export function resolveAccountClass(raw: unknown): ResolvedAccountClass {
  if (raw === 'PRODUCTION') return 'PRODUCTION';
  if (raw === 'INTERNAL_QA') return 'INTERNAL_QA';
  return 'UNKNOWN';
}

/**
 * The one sanctioned way to query `users` for real-user metrics (signups,
 * retention, conversion, ...). Matches `resolveAccountClass(raw) ===
 * 'PRODUCTION'` for exactly the same set of documents — see
 * `__tests__/accountClassification.test.ts`'s parity test.
 */
export function productionUsersQuery(db: Firestore): Query {
  return db.collection(USERS_COLLECTION).where('metadata.accountClass', '==', 'PRODUCTION');
}

/** Explicit opt-in counterpart — never the default for a commercial/operational metric. */
export function internalQaUsersQuery(db: Firestore): Query {
  return db.collection(USERS_COLLECTION).where('metadata.accountClass', '==', 'INTERNAL_QA');
}

/**
 * `UNKNOWN` has no equivalent single-`where()` query — Firestore's equality
 * and `not-in` operators both exclude documents where the field is absent,
 * which is exactly the most common `UNKNOWN` case (a brand-new account,
 * pre-trigger). There is deliberately no `unknownUsersQuery` here that
 * would silently do the wrong thing (e.g. miss every absent-field
 * document); `adminUsers.ts`'s diagnostic `UNKNOWN` filter scans and
 * filters with this resolver in memory instead — see its own comment.
 */
