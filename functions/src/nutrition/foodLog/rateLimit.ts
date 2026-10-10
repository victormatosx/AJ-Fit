import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Per-uid sliding-window cap, same shape as the AI-generation rate limit
 * (`nutritionRateLimits/{uid}`) — shared by `searchExternalFood.ts` and
 * `materializeExternalFood.ts`, each with their OWN field-name prefix so
 * the two external-call budgets never interact with each other or with
 * the AI-generation one.
 */
export async function enforceExternalFoodRateLimit(
  db: Firestore, uid: string, fieldPrefix: string, limit: number, windowMs: number, errorCode: string,
): Promise<void> {
  const rateRef = db.collection('nutritionRateLimits').doc(uid);
  const now = Timestamp.now();
  const startField = `${fieldPrefix}WindowStartedAt`;
  const countField = `${fieldPrefix}WindowCount`;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    const windowStart = snap.get(startField);
    const sameWindow = windowStart instanceof Timestamp && now.toMillis() - windowStart.toMillis() < windowMs;
    const priorCount = sameWindow && Number.isInteger(snap.get(countField)) ? Number(snap.get(countField)) : 0;
    if (priorCount >= limit) throw new HttpsError('resource-exhausted', errorCode);
    tx.set(rateRef, { ownerUid: uid, [startField]: sameWindow ? windowStart : now, [countField]: priorCount + 1, updatedAt: now }, { merge: true });
  });
}
