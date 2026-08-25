import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FinalWorkoutPlan } from './types';

const STORAGE_PREFIX = 'ajfit-workout-prescription-v1';

function snapshotKey(uid: string, planId: string): string {
  return `${STORAGE_PREFIX}:${uid}:${planId}`;
}

function activeKey(uid: string, questionnaireId: string): string {
  return `${STORAGE_PREFIX}:${uid}:questionnaire:${questionnaireId}`;
}

/**
 * Persists the complete final sessions, not a pointer to mutable template
 * content. Existing snapshots are immutable; a reassessment writes a new
 * planId and only advances the small active pointer.
 */
export async function persistPrescriptionSnapshot(
  uid: string,
  questionnaireId: string,
  plan: FinalWorkoutPlan,
): Promise<void> {
  const key = snapshotKey(uid, plan.planId);
  const existing = await AsyncStorage.getItem(key);
  if (!existing) await AsyncStorage.setItem(key, JSON.stringify(plan));
  await AsyncStorage.setItem(activeKey(uid, questionnaireId), plan.planId);
}

export async function readPrescriptionSnapshot(
  uid: string,
  questionnaireId: string,
): Promise<FinalWorkoutPlan | null> {
  const planId = await AsyncStorage.getItem(activeKey(uid, questionnaireId));
  if (!planId) return null;
  const raw = await AsyncStorage.getItem(snapshotKey(uid, planId));
  if (!raw) return null;
  try {
    const plan = JSON.parse(raw) as Partial<FinalWorkoutPlan>;
    if (
      plan.planId !== planId
      || typeof plan.templateId !== 'string'
      || !Array.isArray(plan.sessions)
      || typeof plan.versions?.templateLibrary !== 'string'
    ) return null;
    return plan as FinalWorkoutPlan;
  } catch {
    return null;
  }
}

/** Account-deletion cleanup. Prefix is exact and uid-scoped. */
export async function clearPrescriptionSnapshotsForUser(uid: string): Promise<void> {
  const prefix = `${STORAGE_PREFIX}:${uid}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
