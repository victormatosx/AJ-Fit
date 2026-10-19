import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { deviceTimeZone, todayLocalDate } from '../nutrition/ui/localDate';
import type { NutritionMealSlot } from '../types/nutrition';

export interface PlanSnapshotOrigin { origin: 'plan' | 'alternative' | 'favorite'; documentId: string }
/** UI availability only; authentication/ownership are enforced by the callable. */
export const planSnapshotClientEnabled = (uid: string | null | undefined) => !!uid
  && process.env.EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_ENABLED === 'true';
export async function usesTransactionalDiary(uid: string): Promise<boolean> {
  // Manual operations stay legacy until the account actually enrolls. Enabling
  // snapshot registration must not migrate every manual diary on first use.
  // No cache: a different device may enroll the account at any moment.
  return (await getDoc(doc(db, 'users', uid, 'nutritionDiaryProtocol', 'current'))).exists();
}
export interface DiaryMutationResult { status: 'recorded'; itemIds: string[]; replayed: boolean }
const flights = new Map<string, Promise<DiaryMutationResult>>();
/** Transport retries keep the same persistent request and captured date/timezone.
 * Successful manual actions clear the outbox; option registration is additionally
 * deduped by canonical source/date/slot on the server, including across devices. */
function sendDiaryCommandResult(uid: string, payload: Record<string, unknown>): Promise<DiaryMutationResult> {
  const key = `@ajfit/diary-v1/${uid}/${encodeURIComponent(JSON.stringify(payload))}`;
  const active = flights.get(key); if (active) return active;
  const flight = (async () => {
    const [{ randomUUID }, { httpsCallable }, { functions }, { auth }, { default: AsyncStorage }] = await Promise.all([
      import('expo-crypto'), import('firebase/functions'), import('../lib/firebaseFunctions'), import('../lib/firebase'), import('@react-native-async-storage/async-storage'),
    ]);
    if (auth.currentUser?.uid !== uid) throw new Error('DIARY_ACCOUNT_CHANGED');
    const stored = await AsyncStorage.getItem(key);
    const requestId = stored ?? randomUUID();
    if (!stored) await AsyncStorage.setItem(key, requestId);
    if (auth.currentUser?.uid !== uid) throw new Error('DIARY_ACCOUNT_CHANGED');
    const result = await httpsCallable<unknown, DiaryMutationResult>(functions, 'mutateNutritionDiaryV1')({ ...payload, requestId, expectedUid: uid });
    await AsyncStorage.removeItem(key);
    return result.data;
  })().finally(() => flights.delete(key));
  flights.set(key, flight); return flight;
}
export async function sendDiaryCommand(uid: string, payload: Record<string, unknown>): Promise<void> {
  await sendDiaryCommandResult(uid, payload);
}
export function registerPlanSnapshotOption(uid: string, origin: PlanSnapshotOrigin, optionId: string, slot: NutritionMealSlot): Promise<DiaryMutationResult> {
  return sendDiaryCommandResult(uid, { action: 'register_option', ...origin, optionId, slot,
    localDate: todayLocalDate(), timezone: deviceTimeZone() });
}
