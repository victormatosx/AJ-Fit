import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { db as defaultDb } from '../../lib/firebaseAdmin';
import { requireAuth } from '../../lib/auth';
import { requireActiveAccount } from '../../accountDeletion/activeAccountGuard';
import { requireNutritionRollout } from '../generation/rollout';

function parsePlanId(data: unknown): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpsError('invalid-argument', 'INVALID_REQUEST');
  const value = data as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'planId')
    || typeof value.planId !== 'string' || value.planId.length < 1 || value.planId.length > 120) {
    throw new HttpsError('invalid-argument', 'INVALID_REQUEST');
  }
  return value.planId;
}

/**
 * Restores an archived plan — never calls OpenAI, never recomputes the
 * Nutrition Engine, never touches snapshots (round brief §20/§21). Each
 * plan document is treated as an immutable historical version: restoring
 * flips the SAME document's `status` back to `active` rather than cloning
 * it, mirroring the single-active-plan invariant the generation worker's
 * own activation transaction already enforces (`generation/worker.ts`).
 */
export async function restoreNutritionPlanHandler(
  request: CallableRequest, db: Firestore = defaultDb,
): Promise<{ planId: string }> {
  const uid = requireAuth(request);
  const planId = parsePlanId(request.data);
  try { await requireActiveAccount(uid, db); }
  catch { throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE'); }
  try { await requireNutritionRollout(db, uid); }
  catch { throw new HttpsError('failed-precondition', 'NUTRITION_DISABLED'); }

  const user = db.collection('users').doc(uid);
  const targetRef = user.collection('nutritionPlans').doc(planId);
  const rateRef = db.collection('nutritionRateLimits').doc(uid);

  await db.runTransaction(async (tx) => {
    const [target, lock] = await Promise.all([
      tx.get(targetRef),
      tx.get(db.collection('accountDeletionLocks').doc(uid)),
    ]);
    if (lock.exists) throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE');
    if (!target.exists) throw new HttpsError('not-found', 'PLAN_NOT_FOUND');
    if (target.get('status') !== 'archived') throw new HttpsError('failed-precondition', 'PLAN_NOT_ARCHIVED');

    const rate = await tx.get(rateRef);
    const activePlanId = rate.get('activePlanId');
    const activeRef = typeof activePlanId === 'string' && activePlanId !== planId
      ? user.collection('nutritionPlans').doc(activePlanId) : null;
    const active = activeRef ? await tx.get(activeRef) : null;

    const now = Timestamp.now();
    if (activeRef && active?.exists && active.get('status') === 'active') {
      tx.update(activeRef, { status: 'archived', archivedAt: now });
    }
    tx.update(targetRef, { status: 'active', activatedAt: now, archivedAt: null });
    tx.set(rateRef, { ownerUid: uid, activePlanId: planId, updatedAt: now }, { merge: true });
  });

  return { planId };
}

export const restoreNutritionPlan = onCall(
  { enforceAppCheck: true, timeoutSeconds: 30 },
  (request) => restoreNutritionPlanHandler(request),
);
