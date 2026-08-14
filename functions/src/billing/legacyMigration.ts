import { USERS_COLLECTION } from './constants';

/**
 * Legacy `subscription.endsAt` → `currentPeriodEndsAt` backfill (Sprint 3.6).
 *
 * BACKGROUND
 * ----------
 * `firestore.rules`' `subscriptionValid()` and the backend schema
 * (docs/13_assinaturas_e_billing.md §26) used to accept a field named
 * `endsAt`. Sprint 3.5 renamed it to `currentPeriodEndsAt` everywhere
 * (rules, `functions/src/billing/types.ts`, this project's docs) — EXCEPT
 * the client's own one-time legacy-flat-document migration
 * (`src/services/userProfile.ts`'s `migratedUserDocument()`), which still
 * wrote the old name until Sprint 3.6 fixed it.
 *
 * That means any `users/{uid}` document that already has the NESTED schema
 * (i.e. already went through that client-side migration) from BEFORE the
 * Sprint 3.6 fix may still have `subscription.endsAt` instead of
 * `subscription.currentPeriodEndsAt`. Since `subscriptionValid()` now only
 * allows the new name, such a document would fail Firestore Rules
 * validation on the user's NEXT client write (e.g. editing `profile.name`)
 * — the rules re-validate the whole resulting document, not just the
 * changed fields.
 *
 * This module exists to fix exactly that, and nothing else. It must never
 * touch any field outside `subscription.endsAt` → `subscription.currentPeriodEndsAt`.
 *
 * TECHNICAL PLAN (not yet implemented — see `migrateEndsAtField` below)
 * -----------------------------------------------------------------------
 * 1. DETECT: page through `users` (small collection pre-launch — a plain
 *    `.get()` scan is enough; no need for a filtered query, since Firestore
 *    can't efficiently query "map field X is present" without a composite
 *    index dedicated to this one-off need). For each doc, check whether
 *    `data.subscription` is a map containing the key `endsAt`.
 * 2. DRY RUN (default): only count/log affected uids — SubscriptionValidate
 *    nothing, write nothing. This is the mode a human runs first to decide
 *    whether step 3 is even necessary.
 * 3. APPLY (explicit opt-in only, never automatic): for each affected doc,
 *    in a single per-doc transaction:
 *      - read `subscription.endsAt`'s current value;
 *      - write `subscription.currentPeriodEndsAt` = that value;
 *      - delete `subscription.endsAt` (FieldValue.delete()) so the document
 *        matches `subscriptionValid()`'s `hasOnly(...)` afterward;
 *      - do NOT touch `updatedAt` — this is a structural fix, not a real
 *        subscription event, and must not look like one in analytics.
 *    Use a transaction (not a blind `update`) so a concurrent write from
 *    the real webhook path (Sprint 4+) can never be silently clobbered.
 * 4. IDEMPOTENCY: safe to re-run — a doc with no `endsAt` key is simply
 *    skipped (step 1's filter already excludes it).
 * 5. VERIFY: re-run DETECT (step 1) after APPLY; expect zero matches.
 * 6. This is a manual, human-triggered operation (e.g. a one-off invocation
 *    from a local script authenticated with a service account, or a
 *    temporary admin-only HTTPS function removed right after use) — NEVER a
 *    Cloud Function wired into `index.ts` or any automatic trigger. Nothing
 *    in this file is exported from `index.ts`.
 *
 * OPEN QUESTION FOR A HUMAN (see Sprint 3.6 report): is there any production
 * user who already completed the legacy migration before today? If the
 * answer is no, this entire module is unnecessary and can be deleted
 * instead of implemented.
 */

/**
 * NOT YET IMPLEMENTED. Placeholder for the plan above — deliberately left
 * unimplemented so no backfill can run by accident. Sprint 3.6 explicitly
 * scopes this to "plan + prepared function signature", not a working script;
 * writing the real scan/transaction logic requires the human confirmation
 * described in this file's top comment.
 */
export async function migrateEndsAtField(_dryRun: boolean): Promise<never> {
  throw new Error(
    'migrateEndsAtField not implemented yet — requires human confirmation ' +
      `that legacy-migrated users/{uid} documents with subscription.endsAt exist ` +
      `in the "${USERS_COLLECTION}" collection before writing the real backfill logic. ` +
      'See this file’s top comment for the full plan.',
  );
}
