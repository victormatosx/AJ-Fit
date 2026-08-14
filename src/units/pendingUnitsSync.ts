import AsyncStorage from '@react-native-async-storage/async-storage';
import { isUnitsPreference, type UnitsPreference } from '../types/units';
import { logError } from '../lib/logger';

export type PendingUnitsSync = {
  uid: string;
  value: UnitsPreference;
  createdAt: number;
  attempts: number;
};

export const PENDING_UNITS_STORAGE_KEY = 'ajfit-pending-units-sync';

function isPendingRecord(value: unknown): value is PendingUnitsSync {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.uid === 'string' &&
    record.uid.length > 0 &&
    isUnitsPreference(record.value) &&
    typeof record.createdAt === 'number' &&
    Number.isFinite(record.createdAt) &&
    typeof record.attempts === 'number' &&
    Number.isInteger(record.attempts) &&
    record.attempts >= 0
  );
}

export async function readPendingUnitsSync(): Promise<PendingUnitsSync | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(PENDING_UNITS_STORAGE_KEY);
  } catch (err) {
    logError('pendingUnitsSync:read', err);
    return null;
  }

  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await clearPendingUnitsSync();
    return null;
  }

  if (!isPendingRecord(parsed)) {
    await clearPendingUnitsSync();
    return null;
  }

  return parsed;
}

export async function writePendingUnitsSync(
  pending: PendingUnitsSync,
): Promise<void> {
  if (!isPendingRecord(pending)) {
    throw new Error('[pendingUnitsSync] refuse to persist invalid record');
  }
  await AsyncStorage.setItem(PENDING_UNITS_STORAGE_KEY, JSON.stringify(pending));
}

export async function clearPendingUnitsSync(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_UNITS_STORAGE_KEY);
  } catch (err) {
    logError('pendingUnitsSync:clear', err);
  }
}
