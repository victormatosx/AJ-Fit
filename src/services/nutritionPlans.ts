import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Timestamp, type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db } from '../lib/firebase';
import { functions } from '../lib/firebaseFunctions';
import type { NutritionPlan } from '../types/nutrition';

export type NutritionPlanDoc = NutritionPlan<Timestamp>;

/** A single equality filter on `status`; no composite index needed. */
export function subscribeToActiveNutritionPlan(
  uid: string,
  onPlan: (plan: NutritionPlanDoc | null) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'users', uid, 'nutritionPlans'), where('status', '==', 'active'), limit(1)),
    (snapshot) => onPlan(snapshot.docs[0] ? (snapshot.docs[0].data() as NutritionPlanDoc) : null),
    (error) => onError?.(error),
  );
}

export async function loadNutritionPlan(uid: string, planId: string): Promise<NutritionPlanDoc | null> {
  const snapshot = await getDoc(doc(db, 'users', uid, 'nutritionPlans', planId));
  return snapshot.exists() ? (snapshot.data() as NutritionPlanDoc) : null;
}

/** Active + archived, newest first — a single-field `orderBy` needs no composite index. */
export async function listNutritionPlans(uid: string): Promise<NutritionPlanDoc[]> {
  const snapshot = await getDocs(query(collection(db, 'users', uid, 'nutritionPlans'), orderBy('createdAt', 'desc'), limit(50)));
  return snapshot.docs.map((item) => item.data() as NutritionPlanDoc);
}

/** Keeps target history current after generation or restore; one bounded query, no composite index. */
export function subscribeToNutritionPlans(
  uid: string,
  onPlans: (plans: NutritionPlanDoc[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'users', uid, 'nutritionPlans'), orderBy('createdAt', 'desc'), limit(50)),
    (snapshot) => onPlans(snapshot.docs.map((item) => item.data() as NutritionPlanDoc)),
    (error) => onError?.(error),
  );
}

export interface RestoreNutritionPlanResult { planId: string }

/**
 * Backend-authoritative restore — a transaction, never a client write to
 * `nutritionPlans` (Rules: `write: if false`). Never calls OpenAI, never
 * recomputes the engine, never touches snapshots (round brief §20/§21).
 */
export async function restoreNutritionPlan(planId: string): Promise<RestoreNutritionPlanResult> {
  const callable = httpsCallable<{ planId: string }, RestoreNutritionPlanResult>(functions, 'restoreNutritionPlan');
  return (await callable({ planId })).data;
}
