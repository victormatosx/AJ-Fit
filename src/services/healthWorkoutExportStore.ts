import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  HealthWorkoutExportErrorCode,
  HealthWorkoutExportPlatform,
  HealthWorkoutExportRecord,
  HealthWorkoutExportRecordStatus,
  HealthWorkoutExportState,
} from '../types/healthWorkoutExport';
import type { HealthConnectionIntent } from '../types/healthIntegration';

function key(uid: string, platform: HealthWorkoutExportPlatform): string {
  return `ajfit.health-workout-export.v1:${uid}:${platform}`;
}

let storageQueue: Promise<void> = Promise.resolve();

function withStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.catch(() => undefined).then(operation);
  storageQueue = result.then(() => undefined, () => undefined);
  return result;
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function emptyState(platform: HealthWorkoutExportPlatform): HealthWorkoutExportState {
  return {
    version: 1,
    platform,
    enabledAtIso: null,
    lastIntent: 'not_configured',
    records: {},
  };
}

const RECORD_STATUSES = new Set<HealthWorkoutExportRecordStatus>([
  'pending', 'writing', 'retryable_error', 'permission_required', 'unavailable',
  'blocked_invalid', 'succeeded', 'suppressed',
]);

function parseRecord(value: unknown): HealthWorkoutExportRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<HealthWorkoutExportRecord>;
  if (typeof item.executionId !== 'string' || item.executionId.length === 0
    || !validIso(item.finishedAtIso) || !validIso(item.queuedAtIso)
    || !RECORD_STATUSES.has(item.status as HealthWorkoutExportRecordStatus)
    || !Number.isInteger(item.attemptCount) || (item.attemptCount ?? -1) < 0) return null;
  const status = item.status === 'writing' ? 'pending' : item.status as HealthWorkoutExportRecordStatus;
  return {
    executionId: item.executionId,
    finishedAtIso: item.finishedAtIso,
    status,
    attemptCount: item.attemptCount as number,
    queuedAtIso: item.queuedAtIso,
    lastAttemptAtIso: validIso(item.lastAttemptAtIso) ? item.lastAttemptAtIso : null,
    nextAttemptAtIso: validIso(item.nextAttemptAtIso) ? item.nextAttemptAtIso : null,
    succeededAtIso: validIso(item.succeededAtIso) ? item.succeededAtIso : null,
    nativeRecordId: typeof item.nativeRecordId === 'string' && item.nativeRecordId.length > 0
      ? item.nativeRecordId : null,
    lastErrorCode: typeof item.lastErrorCode === 'string'
      ? item.lastErrorCode as HealthWorkoutExportErrorCode : status === 'pending' && item.status === 'writing'
        ? 'interrupted' : null,
  };
}

function parse(raw: string | null, platform: HealthWorkoutExportPlatform): HealthWorkoutExportState {
  if (!raw) return emptyState(platform);
  try {
    const value = JSON.parse(raw) as Partial<HealthWorkoutExportState>;
    if (value.version !== 1 || value.platform !== platform
      || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) {
      return emptyState(platform);
    }
    const records: Record<string, HealthWorkoutExportRecord> = {};
    Object.values(value.records).forEach((candidate) => {
      const record = parseRecord(candidate);
      if (record) records[record.executionId] = record;
    });
    return {
      version: 1,
      platform,
      enabledAtIso: validIso(value.enabledAtIso) ? value.enabledAtIso : null,
      lastIntent: value.lastIntent === 'enabled' || value.lastIntent === 'disabled'
        ? value.lastIntent : 'not_configured',
      records,
    };
  } catch {
    return emptyState(platform);
  }
}

async function mutateState(
  uid: string,
  platform: HealthWorkoutExportPlatform,
  mutate: (state: HealthWorkoutExportState) => HealthWorkoutExportState,
): Promise<HealthWorkoutExportState> {
  return withStorage(async () => {
    const state = parse(await AsyncStorage.getItem(key(uid, platform)), platform);
    const next = mutate(state);
    await AsyncStorage.setItem(key(uid, platform), JSON.stringify(next));
    return next;
  });
}

export async function readHealthWorkoutExportState(
  uid: string,
  platform: HealthWorkoutExportPlatform,
): Promise<HealthWorkoutExportState> {
  return withStorage(async () => parse(await AsyncStorage.getItem(key(uid, platform)), platform));
}

/**
 * Records the privacy boundary for automatic exports. On reconnect, all
 * unfinished work from the previous enabled period is suppressed and a new
 * cutoff is established. Successfully exported identities are retained.
 */
export async function setHealthWorkoutExportIntentState(
  uid: string,
  platform: HealthWorkoutExportPlatform,
  intent: HealthConnectionIntent,
  now = new Date(),
): Promise<HealthWorkoutExportState> {
  return mutateState(uid, platform, (state) => {
    if (state.lastIntent === intent) return state;
    if (intent !== 'enabled') return { ...state, lastIntent: intent };
    const records = Object.fromEntries(Object.entries(state.records).map(([executionId, record]) => [
      executionId,
      record.status === 'succeeded' ? record : { ...record, status: 'suppressed' as const, nextAttemptAtIso: null },
    ]));
    return { ...state, lastIntent: 'enabled', enabledAtIso: now.toISOString(), records };
  });
}

export async function enqueueHealthWorkoutExport(
  uid: string,
  platform: HealthWorkoutExportPlatform,
  executionId: string,
  finishedAt: Date,
  now = new Date(),
): Promise<HealthWorkoutExportState> {
  return mutateState(uid, platform, (state) => {
    const existing = state.records[executionId];
    if (existing) return state;
    const record: HealthWorkoutExportRecord = {
      executionId,
      finishedAtIso: finishedAt.toISOString(),
      status: 'pending',
      attemptCount: 0,
      queuedAtIso: now.toISOString(),
      lastAttemptAtIso: null,
      nextAttemptAtIso: null,
      succeededAtIso: null,
      nativeRecordId: null,
      lastErrorCode: null,
    };
    return { ...state, records: { ...state.records, [executionId]: record } };
  });
}

export async function markHealthWorkoutExportWriting(
  uid: string,
  platform: HealthWorkoutExportPlatform,
  executionId: string,
  now = new Date(),
): Promise<HealthWorkoutExportState> {
  return mutateState(uid, platform, (state) => {
    const record = state.records[executionId];
    if (!record || record.status === 'succeeded' || record.status === 'suppressed') return state;
    return {
      ...state,
      records: {
        ...state.records,
        [executionId]: {
          ...record,
          status: 'writing',
          attemptCount: record.attemptCount + 1,
          lastAttemptAtIso: now.toISOString(),
          nextAttemptAtIso: null,
          lastErrorCode: null,
        },
      },
    };
  });
}

export async function markHealthWorkoutExportSucceeded(
  uid: string,
  platform: HealthWorkoutExportPlatform,
  executionId: string,
  nativeRecordId: string,
  now = new Date(),
): Promise<HealthWorkoutExportState> {
  return mutateState(uid, platform, (state) => {
    const record = state.records[executionId];
    if (!record) return state;
    return {
      ...state,
      records: {
        ...state.records,
        [executionId]: {
          ...record,
          status: 'succeeded',
          succeededAtIso: now.toISOString(),
          nativeRecordId,
          nextAttemptAtIso: null,
          lastErrorCode: null,
        },
      },
    };
  });
}

export async function markHealthWorkoutExportFailed(
  uid: string,
  platform: HealthWorkoutExportPlatform,
  executionId: string,
  input: {
    status: Extract<HealthWorkoutExportRecordStatus, 'retryable_error' | 'permission_required' | 'unavailable' | 'blocked_invalid'>;
    errorCode: HealthWorkoutExportErrorCode;
    nextAttemptAt: Date | null;
  },
): Promise<HealthWorkoutExportState> {
  return mutateState(uid, platform, (state) => {
    const record = state.records[executionId];
    if (!record || record.status === 'succeeded' || record.status === 'suppressed') return state;
    return {
      ...state,
      records: {
        ...state.records,
        [executionId]: {
          ...record,
          status: input.status,
          lastErrorCode: input.errorCode,
          nextAttemptAtIso: input.nextAttemptAt?.toISOString() ?? null,
        },
      },
    };
  });
}

export function healthWorkoutExportPendingCount(state: HealthWorkoutExportState): number {
  return Object.values(state.records).filter((record) => [
    'pending', 'writing', 'retryable_error', 'permission_required', 'unavailable',
  ].includes(record.status)).length;
}

export function healthWorkoutExportLastSuccess(state: HealthWorkoutExportState): Date | null {
  const latest = Object.values(state.records)
    .map((record) => record.succeededAtIso)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  return latest ? new Date(latest) : null;
}

