/**
 * Backend authority for `users/{uid}.metadata.accountClass`
 * (lib/accountClassification.ts owns the type/resolver/query helpers).
 *
 * Two writers, and only these two:
 *
 *   1. `onUserProvisioned` — stamps `'PRODUCTION'` immediately after the
 *      client creates `users/{uid}` (see `src/services/userProfile.ts`'s
 *      `provisionNewUser`, which never writes this field itself —
 *      `firestore.rules` rejects the key at `create` time). A brand-new
 *      signup is never automatically `INTERNAL_QA` — that always requires
 *      a deliberate, subsequent admin action.
 *   2. `adminSetAccountClassHandler` — the ONLY way an account ever moves
 *      to/from `INTERNAL_QA`, gated by `requireAdminUid`.
 *
 * Idempotent by construction: `onUserProvisioned` only writes when the
 * field is still absent (a redelivered creation event, or a hypothetical
 * admin reclassification racing it, never gets overwritten back to
 * `PRODUCTION`).
 *
 * ── The provisioning window (client creates the doc → trigger stamps it) ──
 *
 * `onDocumentCreated` is asynchronous — there is a real gap, typically
 * sub-second but not bounded, between the client's `users/{uid}` write and
 * this trigger's own write. During that gap `metadata.accountClass` is
 * absent, which `lib/accountClassification.ts`'s `resolveAccountClass`
 * resolves to `'UNKNOWN'` — NOT `'PRODUCTION'`. That is precisely why this
 * is safe: the account is correctly excluded from every production
 * metric/query for the duration of the gap, exactly as it would be if the
 * trigger failed permanently (quota exhaustion, a bug, the function being
 * deleted). There is no fallback path anywhere that promotes `'UNKNOWN'`
 * to `'PRODUCTION'` — a stuck `'UNKNOWN'` account stays excluded forever
 * until an admin explicitly calls `adminSetAccountClassHandler`, which
 * `adminUsers.ts`'s `accountClassFilter: 'UNKNOWN'` diagnostic view exists
 * to surface. No change to the client-side provisioning flow
 * (`src/services/userProfile.ts`) was needed to make this safe — moving
 * that authority to a synchronous backend callable would be a much larger
 * change than this bug required, and the client still never gets to decide
 * its own class either way.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { requireAdminUid } from '../attribution/adminAuth';
import { db } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import {
  ACCOUNT_CLASSES,
  resolveAccountClass,
  USERS_COLLECTION,
  type AccountClass,
} from '../lib/accountClassification';

const SCOPE = 'adminUsers:accountClass';

/** Testable core, independent of the `onDocumentCreated` wiring below. */
export async function provisionAccountClass(
  uid: string,
  snapshot: { get(field: string): unknown; ref: { update(patch: Record<string, unknown>): Promise<unknown> } },
): Promise<void> {
  if (snapshot.get('metadata.accountClass') !== undefined) return;
  await snapshot.ref.update({ 'metadata.accountClass': 'PRODUCTION' });
  logInfo(SCOPE, 'account_class_provisioned', { uid, accountClass: 'PRODUCTION' });
}

export const onUserProvisioned = onDocumentCreated(
  `${USERS_COLLECTION}/{uid}`,
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    await provisionAccountClass(event.params.uid, snapshot);
  },
);

interface SetAccountClassInput {
  uid?: unknown;
  accountClass?: unknown;
}

function parseInput(value: unknown): { uid: string; accountClass: AccountClass } {
  const data = typeof value === 'object' && value !== null ? (value as SetAccountClassInput) : {};
  if (typeof data.uid !== 'string' || !data.uid) throw new HttpsError('invalid-argument', 'invalid_uid');
  if (typeof data.accountClass !== 'string' || !(ACCOUNT_CLASSES as readonly string[]).includes(data.accountClass)) {
    throw new HttpsError('invalid-argument', 'invalid_account_class');
  }
  return { uid: data.uid, accountClass: data.accountClass as AccountClass };
}

/**
 * Admin-only reclassification. Never derives the target class from any
 * other axis (billing origin, notification mode, etc.) — the admin states
 * it explicitly, every time. See `../lib/__tests__/accountClassAxisIndependence.test.ts`.
 */
export async function adminSetAccountClassHandler(request: CallableRequest<unknown>) {
  const adminUid = await requireAdminUid(request);
  const { uid, accountClass } = parseInput(request.data);

  try {
    const ref = db.collection(USERS_COLLECTION).doc(uid);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpsError('not-found', 'user_not_found');

    const previous = resolveAccountClass(snapshot.get('metadata.accountClass'));
    if (previous === accountClass) {
      return { uid, accountClass, changed: false };
    }

    await ref.update({
      'metadata.accountClass': accountClass,
      'metadata.updatedAt': FieldValue.serverTimestamp(),
    });
    logInfo(SCOPE, 'account_class_changed', { adminUid, uid, previous, next: accountClass });
    return { uid, accountClass, changed: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logFunctionError(SCOPE, error, { adminUid, uid, operation: 'set_account_class' });
    throw new HttpsError('internal', 'admin_set_account_class_failed');
  }
}
