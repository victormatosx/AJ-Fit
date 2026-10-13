import { httpsCallable } from 'firebase/functions';
import {
  collection, doc, limit, onSnapshot, query, where,
  type Timestamp, type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { functions } from '../lib/firebaseFunctions';
import type { NutritionGenerationJob } from '../types/nutrition';

const REQUEST_NUTRITION_PLAN_GENERATION_CALLABLE = 'requestNutritionPlanGeneration';

export interface RequestNutritionPlanGenerationResult { generationId: string }

/**
 * The ONLY client entry point into AI plan generation. Every safety/cooldown/
 * eligibility check happens server-side; a rejected call surfaces its
 * `HttpsError` message verbatim (e.g. `NUTRITION_GENERATION_DISABLED`,
 * `NUTRITION_GENERATION_COOLDOWN`, `ACCOUNT_INACTIVE`) for the caller to map
 * to UX copy — never re-implemented here.
 */
export async function requestNutritionPlanGeneration(
  requestId?: string,
): Promise<RequestNutritionPlanGenerationResult> {
  const callable = httpsCallable<{ requestId?: string } | undefined, RequestNutritionPlanGenerationResult>(
    functions, REQUEST_NUTRITION_PLAN_GENERATION_CALLABLE,
  );
  return (await callable(requestId ? { requestId } : undefined)).data;
}

export type NutritionGenerationJobDoc = NutritionGenerationJob<Timestamp> & { generationId: string };

/** Read-only listener for the job the user is waiting on — survives navigation/background. */
export function subscribeToNutritionGenerationJob(
  uid: string, generationId: string,
  onJob: (job: NutritionGenerationJobDoc | null) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid, 'nutritionGenerationJobs', generationId),
    (snapshot) => onJob(snapshot.exists() ? { ...(snapshot.data() as NutritionGenerationJob<Timestamp>), generationId } : null),
    (error) => onError?.(error),
  );
}

const ACTIVE_JOB_STATUSES = ['queued', 'running', 'validating'] as const;

/**
 * Resumes tracking across navigation/app restarts (states_and_loading.md
 * §5): backend single-flight guarantees at most one job in these statuses
 * per user, so the first match is unambiguous. A single equality/`in`
 * filter needs no composite index, so this deliberately avoids `orderBy`.
 */
export function subscribeToActiveNutritionGenerationJob(
  uid: string,
  onJob: (job: NutritionGenerationJobDoc | null) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'users', uid, 'nutritionGenerationJobs'),
      where('status', 'in', [...ACTIVE_JOB_STATUSES]), limit(1)),
    (snapshot) => {
      const first = snapshot.docs[0];
      onJob(first ? { ...(first.data() as NutritionGenerationJob<Timestamp>), generationId: first.id } : null);
    },
    (error) => onError?.(error),
  );
}
