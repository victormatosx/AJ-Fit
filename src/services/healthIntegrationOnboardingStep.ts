/**
 * Persistence for the health-integration offer made DURING the initial
 * questionnaire (Fase 5) — the funnel step itself runs pre-auth, with no uid
 * yet, so its "Conectar"/"Agora não" choice is recorded only in the local
 * anonymous draft (`onboarding/draftStorage.ts`). This module picks up from
 * there, once a real uid exists:
 *
 * - "Agora não" (or no choice at all) needs nothing further — `markSeen`
 *   records that this uid never needs to be asked again.
 * - "Conectar" needs one more explicit tap before the native permission
 *   dialog can open (never silently, right after sign-up) — `markPending`
 *   records that a one-time confirmation sheet is still owed to this uid;
 *   `clearPending` (always paired with `markSeen`) resolves it either way
 *   once the user taps Conectar/Agora não on that sheet.
 *
 * Deliberately local-only (`AsyncStorage`, scoped per uid), mirroring
 * `healthIntegrationPreferences.ts` exactly: nothing here needs to survive a
 * reinstall or sync across devices, and a Firestore field would need a new
 * allow-listed `firestore.rules` entry for no real benefit.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

function seenKey(uid: string): string {
  return `ajfit.health-integration.onboarding-step-seen.v1:${uid}`;
}

function pendingConfirmationKey(uid: string): string {
  return `ajfit.health-integration.onboarding-step-pending-confirmation.v1:${uid}`;
}

// Same global FIFO queue pattern as `healthIntegrationPreferences.ts`, so
// reads/writes for the same uid (or different ones) never race the
// underlying storage.
let storageQueue: Promise<void> = Promise.resolve();

function withStorage<T>(operation: () => Promise<T>): Promise<T> {
  let resolveResult: (value: T) => void;
  let rejectResult: (cause: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  storageQueue = storageQueue.catch(() => undefined).then(async () => {
    try {
      resolveResult(await operation());
    } catch (cause) {
      rejectResult(cause);
    }
  });
  return result;
}

// In-memory hints only — never the source of truth by themselves. Cleared on
// logout purely so they don't keep growing for every account that ever
// touched this device; the persisted AsyncStorage values survive logout,
// same rationale as `healthIntegrationPreferences.ts`.
const seenByUid = new Map<string, boolean>();
const pendingConfirmationByUid = new Map<string, boolean>();

export function getLastKnownHealthIntegrationOnboardingStepSeen(uid: string): boolean | undefined {
  return seenByUid.get(uid);
}

export async function readHealthIntegrationOnboardingStepSeen(uid: string): Promise<boolean> {
  const seen = await withStorage(async () => (await AsyncStorage.getItem(seenKey(uid))) === '1');
  seenByUid.set(uid, seen);
  return seen;
}

export async function markHealthIntegrationOnboardingStepSeen(uid: string): Promise<void> {
  seenByUid.set(uid, true);
  await withStorage(async () => {
    await AsyncStorage.setItem(seenKey(uid), '1');
  });
}

export function getLastKnownHealthIntegrationOnboardingPendingConfirmation(uid: string): boolean | undefined {
  return pendingConfirmationByUid.get(uid);
}

export async function readHealthIntegrationOnboardingPendingConfirmation(uid: string): Promise<boolean> {
  const pending = await withStorage(async () => (await AsyncStorage.getItem(pendingConfirmationKey(uid))) === '1');
  pendingConfirmationByUid.set(uid, pending);
  return pending;
}

export async function markHealthIntegrationOnboardingPendingConfirmation(uid: string): Promise<void> {
  pendingConfirmationByUid.set(uid, true);
  await withStorage(async () => {
    await AsyncStorage.setItem(pendingConfirmationKey(uid), '1');
  });
}

/** Resolves the pending confirmation either way — always pair with `markHealthIntegrationOnboardingStepSeen`. */
export async function clearHealthIntegrationOnboardingPendingConfirmation(uid: string): Promise<void> {
  pendingConfirmationByUid.set(uid, false);
  await withStorage(async () => {
    await AsyncStorage.setItem(pendingConfirmationKey(uid), '0');
  });
}

export function clearHealthIntegrationOnboardingStepSessionState(uid: string): void {
  seenByUid.delete(uid);
  pendingConfirmationByUid.delete(uid);
}
