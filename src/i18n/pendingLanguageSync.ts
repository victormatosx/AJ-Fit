import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupportedLanguage, type SupportedLanguage } from '../types/language';

/**
 * Local record of a language choice that hasn't been confirmed by Firestore
 * yet. Written when the user picks a language while authenticated; cleared
 * when the remote write is confirmed OR when reconciliation determines the
 * pending belongs to a different account (device sign-out/sign-in) — never
 * cleared by logout, and never by time.
 *
 * The UID stamp is what prevents a pending from a previous account leaking
 * into a new account on the same device — reconciliation refuses to apply
 * or push a pending whose UID doesn't match the currently-loaded user.
 */
export type PendingLanguageSync = {
  uid: string;
  value: SupportedLanguage;
  createdAt: number;
  attempts: number;
};

export const PENDING_LANGUAGE_STORAGE_KEY = 'ajfit-pending-language-sync';

function isPendingRecord(value: unknown): value is PendingLanguageSync {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.uid === 'string' &&
    v.uid.length > 0 &&
    isSupportedLanguage(v.value) &&
    typeof v.createdAt === 'number' &&
    Number.isFinite(v.createdAt) &&
    typeof v.attempts === 'number' &&
    Number.isInteger(v.attempts) &&
    v.attempts >= 0
  );
}

export async function readPendingLanguageSync(): Promise<PendingLanguageSync | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(PENDING_LANGUAGE_STORAGE_KEY);
  } catch (err) {
    console.error('[pendingLanguageSync] read failed, treating as absent', err);
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupted JSON — discard silently so a bad blob doesn't wedge the app.
    await clearPendingLanguageSync();
    return null;
  }
  if (!isPendingRecord(parsed)) {
    // Wrong shape (schema drift, hand-edit, older writer) — discard.
    await clearPendingLanguageSync();
    return null;
  }
  return parsed;
}

export async function writePendingLanguageSync(
  pending: PendingLanguageSync,
): Promise<void> {
  if (!isPendingRecord(pending)) {
    throw new Error('[pendingLanguageSync] refuse to persist invalid record');
  }
  await AsyncStorage.setItem(
    PENDING_LANGUAGE_STORAGE_KEY,
    JSON.stringify(pending),
  );
}

export async function clearPendingLanguageSync(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_LANGUAGE_STORAGE_KEY);
  } catch (err) {
    // Best-effort cleanup — never throw. If a stale pending survives, it
    // will be re-validated on the next read and dropped if the UID doesn't
    // match the current user.
    console.error('[pendingLanguageSync] clear failed', err);
  }
}
