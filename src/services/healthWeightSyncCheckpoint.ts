import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  HEALTH_WEIGHT_INITIAL_HISTORY_DAYS,
  type HealthWeightPlatform,
  type HealthWeightSyncCheckpoint,
} from '../types/healthWeightSync';

function key(uid: string, platform: HealthWeightPlatform): string {
  return `ajfit.health-weight-sync.v1:${uid}:${platform}`;
}

let storageQueue: Promise<void> = Promise.resolve();

function withStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.catch(() => undefined).then(operation);
  storageQueue = result.then(() => undefined, () => undefined);
  return result;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) return null;
  return value;
}

function parse(raw: string | null, platform: HealthWeightPlatform): HealthWeightSyncCheckpoint | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<HealthWeightSyncCheckpoint>;
    const historyStartIso = isoOrNull(value.historyStartIso);
    if (value.version !== 1 || value.platform !== platform || !historyStartIso) return null;
    return {
      version: 1,
      platform,
      historyStartIso,
      cursor: typeof value.cursor === 'string' && value.cursor.length > 0 ? value.cursor : null,
      lastSuccessfulAtIso: isoOrNull(value.lastSuccessfulAtIso),
      ignoreMeasuredBeforeIso: isoOrNull(value.ignoreMeasuredBeforeIso),
    };
  } catch {
    return null;
  }
}

export function createHealthWeightSyncCheckpoint(
  platform: HealthWeightPlatform,
  now = new Date(),
): HealthWeightSyncCheckpoint {
  return {
    version: 1,
    platform,
    historyStartIso: new Date(
      now.getTime() - HEALTH_WEIGHT_INITIAL_HISTORY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
    cursor: null,
    lastSuccessfulAtIso: null,
    ignoreMeasuredBeforeIso: null,
  };
}

export async function readHealthWeightSyncCheckpoint(
  uid: string,
  platform: HealthWeightPlatform,
): Promise<HealthWeightSyncCheckpoint | null> {
  return withStorage(async () => parse(await AsyncStorage.getItem(key(uid, platform)), platform));
}

export async function writeHealthWeightSyncCheckpoint(
  uid: string,
  checkpoint: HealthWeightSyncCheckpoint,
): Promise<void> {
  await withStorage(async () => {
    await AsyncStorage.setItem(key(uid, checkpoint.platform), JSON.stringify(checkpoint));
  });
}

export function effectiveHealthWeightHistoryStart(checkpoint: HealthWeightSyncCheckpoint): Date {
  const history = new Date(checkpoint.historyStartIso);
  const ignoreBefore = checkpoint.ignoreMeasuredBeforeIso
    ? new Date(checkpoint.ignoreMeasuredBeforeIso)
    : null;
  return ignoreBefore && ignoreBefore > history ? ignoreBefore : history;
}

export async function markImportedWeightsDeleted(
  uid: string,
  platform: HealthWeightPlatform,
  deletedAt = new Date(),
): Promise<HealthWeightSyncCheckpoint> {
  const checkpoint = await readHealthWeightSyncCheckpoint(uid, platform)
    ?? createHealthWeightSyncCheckpoint(platform, deletedAt);
  const next = { ...checkpoint, ignoreMeasuredBeforeIso: deletedAt.toISOString() };
  await writeHealthWeightSyncCheckpoint(uid, next);
  return next;
}
