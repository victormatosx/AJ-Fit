import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { db } from '../lib/firebaseAdmin';
import { userDocPath } from './constants';

/**
 * Server-side admin authorization for the promo-code admin surface
 * (`adminCreatePromoCode`/`adminUpdatePromoCode`/`adminSetPromoCodeActive`/
 * `adminListPromoCodes`). Mirrors the ONLY admin signal that exists anywhere
 * in this codebase today — `users/{uid}.metadata.role === 'admin'`, the same
 * field `ajfit-admin`'s client checks client-side after login (see that
 * repo's `App.jsx`) and the same field `docs/firebase-permissions-report.md`
 * proposes for a future `isAdmin()` Firestore rule. That client-side check
 * and the (still unmerged) rules proposal are both advisory/UX only — this
 * function is the actual server-side enforcement point, re-verified on every
 * call via the Admin SDK (bypasses Firestore Rules by design), because
 * `firestore.rules`'s `promoCodes` block intentionally stays `allow read,
 * write: if false` for every client, including admins (see that file's
 * comment) — the client is NEVER trusted to assert its own role.
 *
 * No custom-claims mechanism exists yet in this project (searched: zero
 * `setCustomUserClaims` calls anywhere in `functions/src`). Adopting one is
 * a bigger, separate architectural change (docs/firebase-permissions-report.md
 * §1 flags it as the recommended evolution) — out of scope here. Reading
 * `users/{uid}` per call is an extra read but this is a low-QPS admin
 * surface, not a hot path.
 */

export async function requireAdminUid(request: CallableRequest<unknown>): Promise<string> {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'authentication_required');
  }
  const uid = request.auth.uid;

  const snapshot = await db.doc(userDocPath(uid)).get();
  const role = snapshot.exists ? (snapshot.data() as Record<string, unknown>)?.metadata : undefined;
  const roleValue =
    role && typeof role === 'object' ? (role as Record<string, unknown>).role : undefined;

  if (roleValue !== 'admin') {
    throw new HttpsError('permission-denied', 'admin_role_required');
  }

  return uid;
}
