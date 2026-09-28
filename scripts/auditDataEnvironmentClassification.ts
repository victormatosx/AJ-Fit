#!/usr/bin/env -S node --import tsx
/**
 * QA/Sandbox vs Production data-environment audit (pre-launch, no real
 * users yet — see docs task "Auditoria e separação QA/Sandbox/Produção").
 *
 * Read-only by default. Reports, per collection, how many documents
 * classify as PRODUCTION / SANDBOX / QA / UNKNOWN, using ONLY the
 * authoritative field each domain already writes — this script never
 * infers an environment from anything else:
 *
 *   - `subscriptionTransactions.environment` — written verbatim from
 *     RevenueCat's webhook `event.environment` (functions/src/billing/
 *     financialEnvironment.ts normalizes to PRODUCTION|SANDBOX|UNKNOWN,
 *     fails closed, never guesses PRODUCTION).
 *   - `notificationDispatches.dispatchMode` — written by the backend
 *     dispatcher itself (functions/src/notifications/schema.ts:
 *     PRODUCT|QA_PREVIEW). Documents predating this field's introduction
 *     have no `dispatchMode` at all; this script's ONLY mutation is
 *     backfilling those to the explicit value the codebase already treats
 *     them as on read (functions/src/notifications/idempotency.ts's
 *     `dispatchMode ?? 'PRODUCT'` fallback) — never inferring a value that
 *     isn't already the de facto behavior, and only ever writing 'PRODUCT'
 *     for docs whose `type` is a real product notification type (never
 *     'QA_TEST', which would indicate a genuine QA dispatch predating the
 *     field).
 *   - `users/{uid}.metadata.accountClass` — a THIRD, independent axis
 *     (functions/src/lib/accountClassification.ts): account identity, not
 *     billing/notification origin. Unlike the two collections above, this
 *     is a DELIBERATE pre-launch override: every account today is a
 *     development/QA account (no real users exist yet), so this script's
 *     `users` mutation plan sets `accountClass: 'INTERNAL_QA'` on every
 *     document that isn't already exactly that — including ones that would
 *     otherwise resolve to the ordinary `PRODUCTION` default (absent field)
 *     or were explicitly stamped `PRODUCTION`. This is the ONE sanctioned
 *     exception to "never infer/convert toward the non-default state" in
 *     this script: it is a one-time, human-authorized batch reclassification
 *     of known-test accounts before launch, not an ongoing inference rule.
 *     After launch this script's `users` mode should not be re-run against
 *     real signups.
 *
 * Never converts SANDBOX/QA_PREVIEW to PRODUCTION/PRODUCT by inference —
 * that direction never happens in this script, by construction. Idempotent:
 * running twice makes no further changes the second time.
 *
 * Usage (dry run — always safe, the default):
 *   npx tsx scripts/auditDataEnvironmentClassification.ts --project <firebase-project-id>
 *
 * Usage (apply, after reviewing the dry-run report):
 *   npx tsx scripts/auditDataEnvironmentClassification.ts --project <firebase-project-id> --apply
 *
 * Scope a single collection (either audit or apply):
 *   ... --collection subscriptionTransactions
 *   ... --collection notificationDispatches
 *   ... --collection users
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const REVENUECAT_ENVIRONMENTS = new Set(['PRODUCTION', 'SANDBOX']);
/** Never a QA/preview-eligible type — see functions/src/notifications/contentPolicy.ts's QA_PREVIEW_NOTIFICATION_TYPES. */
const NOTIFICATION_TYPES_SAFE_TO_BACKFILL_AS_PRODUCT = new Set([
  'EVOLUTION_UNLOCKED', 'EVOLUTION_APPROACHING', 'PROGRAM_UPDATED', 'BILLING_ISSUE',
  'PREMIUM_ENDED', 'WORKOUT_DAY', 'RECOVERY_DAY', 'MISSED_WORKOUT', 'RE_ENGAGEMENT_EARLY',
  'RE_ENGAGEMENT_LATE', 'PHOTO_REMINDER', 'ASSESSMENT_REMINDER', 'COMPARE_PROGRESS',
  'WEEK_COMPLETED', 'WEEK_STREAK', 'SUPPORT_SINGLE_REPLY', 'SUPPORT_CHAT_MESSAGE',
]);

async function auditSubscriptionTransactions(db: FirebaseFirestore.Firestore) {
  const snapshot = await db.collection('subscriptionTransactions').get();
  const counts: Record<string, number> = { PRODUCTION: 0, SANDBOX: 0, UNKNOWN: 0 };
  const ambiguous: string[] = [];
  for (const doc of snapshot.docs) {
    const raw = doc.get('environment');
    if (REVENUECAT_ENVIRONMENTS.has(raw)) {
      counts[raw] += 1;
    } else {
      counts.UNKNOWN += 1;
      ambiguous.push(doc.id);
    }
  }
  return {
    collection: 'subscriptionTransactions',
    totalDocuments: snapshot.size,
    counts,
    // Already-typed field (functions/src/billing/financialEnvironment.ts);
    // this script never writes to this collection — a financial ledger is
    // never touched by anything but the verified RevenueCat webhook.
    mutationPlan: [],
    ambiguousDocumentIds: ambiguous,
  };
}

async function auditNotificationDispatches(db: FirebaseFirestore.Firestore, apply: boolean) {
  const snapshot = await db.collection('notificationDispatches').get();
  const counts: Record<string, number> = { PRODUCT: 0, QA_PREVIEW: 0, MISSING: 0 };
  const backfillable: QueryDocumentSnapshot[] = [];
  const unclassifiable: string[] = [];
  for (const doc of snapshot.docs) {
    const mode = doc.get('dispatchMode');
    if (mode === 'PRODUCT' || mode === 'QA_PREVIEW') {
      counts[mode] += 1;
      continue;
    }
    counts.MISSING += 1;
    const type = doc.get('type');
    if (NOTIFICATION_TYPES_SAFE_TO_BACKFILL_AS_PRODUCT.has(type)) {
      backfillable.push(doc);
    } else {
      // Fails closed: a missing dispatchMode on a QA_TEST (or any type this
      // script doesn't recognize) is reported, never silently backfilled.
      unclassifiable.push(doc.id);
    }
  }

  const mutationPlan = backfillable.map((doc) => ({
    path: doc.ref.path,
    type: doc.get('type'),
    patch: { dispatchMode: 'PRODUCT' },
  }));

  if (apply && backfillable.length > 0) {
    const BATCH_SIZE = 400;
    for (let i = 0; i < backfillable.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const doc of backfillable.slice(i, i + BATCH_SIZE)) {
        batch.update(doc.ref, { dispatchMode: 'PRODUCT' });
      }
      await batch.commit();
    }
  }

  return {
    collection: 'notificationDispatches',
    totalDocuments: snapshot.size,
    counts,
    mutationPlan,
    unclassifiableDocumentIds: unclassifiable,
    applied: apply && backfillable.length > 0,
  };
}

async function auditUsersAccountClass(db: FirebaseFirestore.Firestore, apply: boolean) {
  const snapshot = await db.collection('users').get();
  const counts = { alreadyInternalQa: 0, absent: 0, explicitProduction: 0, ambiguous: 0 };
  const toChange: QueryDocumentSnapshot[] = [];
  const ambiguousDocumentIds: string[] = [];

  for (const doc of snapshot.docs) {
    const raw = doc.get('metadata.accountClass');
    if (raw === 'INTERNAL_QA') {
      counts.alreadyInternalQa += 1;
      continue;
    }
    if (raw === undefined || raw === null) {
      counts.absent += 1;
    } else if (raw === 'PRODUCTION') {
      counts.explicitProduction += 1;
    } else {
      counts.ambiguous += 1;
      ambiguousDocumentIds.push(doc.id);
    }
    toChange.push(doc);
  }

  const mutationPlan = toChange.map((doc) => ({
    path: doc.ref.path,
    previousAccountClass: doc.get('metadata.accountClass') ?? null,
    patch: { 'metadata.accountClass': 'INTERNAL_QA' },
  }));

  if (apply && toChange.length > 0) {
    const BATCH_SIZE = 400;
    for (let i = 0; i < toChange.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const doc of toChange.slice(i, i + BATCH_SIZE)) {
        batch.update(doc.ref, { 'metadata.accountClass': 'INTERNAL_QA' });
      }
      await batch.commit();
    }
  }

  return {
    collection: 'users',
    totalDocuments: snapshot.size,
    counts: {
      total: snapshot.size,
      wouldChangeToInternalQa: toChange.length,
      alreadyCorrect: counts.alreadyInternalQa,
      ambiguous: counts.ambiguous,
      breakdown: counts,
    },
    mutationPlan,
    ambiguousDocumentIds,
    applied: apply && toChange.length > 0,
  };
}

async function main(): Promise<void> {
  const projectId = valueAfter('--project');
  const collectionFilter = valueAfter('--collection');
  const apply = process.argv.includes('--apply');
  if (!projectId) {
    throw new Error('Usage: --project <id> [--collection subscriptionTransactions|notificationDispatches|users] [--apply]');
  }

  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  const reports: unknown[] = [];
  if (!collectionFilter || collectionFilter === 'subscriptionTransactions') {
    reports.push(await auditSubscriptionTransactions(db));
  }
  if (!collectionFilter || collectionFilter === 'notificationDispatches') {
    reports.push(await auditNotificationDispatches(db, apply));
  }
  if (!collectionFilter || collectionFilter === 'users') {
    reports.push(await auditUsersAccountClass(db, apply));
  }

  console.log(JSON.stringify({ projectId, dryRun: !apply, reports }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
