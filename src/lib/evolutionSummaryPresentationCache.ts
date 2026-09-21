import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProgressingSummary } from '../workoutEvolution/types';

/**
 * Persisted presentation projection only. In particular, this deliberately
 * omits earned/pending/action/lifecycle/authority state. It must never be
 * passed to domain services or used to decide whether an action is allowed.
 */
export type EvolutionSummaryPresentationCache = {
  schemaVersion: 1;
  uid: string;
  programInstanceId: string;
  updatedAt: number;
  summary: {
    activeLevel: ProgressingSummary['activeLevel'];
    cycleNumber: number;
    proximity: ProgressingSummary['proximity'];
    activeDays: number | null;
    sessionsCompleted: number | null;
    adherenceQuality: ProgressingSummary['adherenceQuality'];
  };
};

export type EvolutionSummaryPresentationCacheRead =
  | 'miss'
  | 'invalid'
  | 'program-mismatch'
  | EvolutionSummaryPresentationCache;

const SCHEMA_VERSION = 1;
const keyFor = (uid: string) => `ajfit:evolution-summary-presentation:v1:${uid}`;
const blockedUids = new Set<string>();
const pendingByUid = new Map<string, Promise<void>>();

function enqueue(uid: string, operation: () => Promise<void>): Promise<void> {
  const previous = pendingByUid.get(uid) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  pendingByUid.set(uid, pending);
  void pending.finally(() => {
    if (pendingByUid.get(uid) === pending) pendingByUid.delete(uid);
  }).catch(() => undefined);
  return pending;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isNonNegativeIntegerOrNull(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function parseUnchecked(raw: string): EvolutionSummaryPresentationCache | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !hasOnlyKeys(value, [
      'schemaVersion', 'uid', 'programInstanceId', 'updatedAt', 'summary',
    ])) return null;
    if (value.schemaVersion !== SCHEMA_VERSION || !isIdentity(value.uid) ||
        !isIdentity(value.programInstanceId) || typeof value.updatedAt !== 'number' ||
        !Number.isFinite(value.updatedAt) || value.updatedAt < 0 ||
        value.updatedAt > Date.now() + 60_000 || !isRecord(value.summary) ||
        !hasOnlyKeys(value.summary, [
          'activeLevel', 'cycleNumber', 'proximity', 'activeDays',
          'sessionsCompleted', 'adherenceQuality',
        ])) return null;

    const summary = value.summary;
    if (!['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].includes(String(summary.activeLevel)) ||
        !Number.isSafeInteger(summary.cycleNumber) || (summary.cycleNumber as number) < 1 ||
        (summary.proximity !== null && !['BUILDING', 'ON_TRACK', 'READY'].includes(String(summary.proximity))) ||
        !isNonNegativeIntegerOrNull(summary.activeDays) ||
        !isNonNegativeIntegerOrNull(summary.sessionsCompleted) ||
        (summary.adherenceQuality !== null &&
          !['BELOW_TARGET', 'GOOD', 'HIGH'].includes(String(summary.adherenceQuality)))) return null;

    return value as EvolutionSummaryPresentationCache;
  } catch {
    return null;
  }
}

export function parseEvolutionSummaryPresentationCache(
  raw: string,
  uid: string,
  programInstanceId: string,
): EvolutionSummaryPresentationCache | null {
  const value = parseUnchecked(raw);
  return value?.uid === uid && value.programInstanceId === programInstanceId ? value : null;
}

async function removeIfUnchanged(uid: string, raw: string): Promise<void> {
  await enqueue(uid, async () => {
    const current = await AsyncStorage.getItem(keyFor(uid));
    if (current === raw) await AsyncStorage.removeItem(keyFor(uid));
  });
}

export async function readEvolutionSummaryPresentationCache(
  uid: string,
  programInstanceId: string,
): Promise<EvolutionSummaryPresentationCacheRead> {
  blockedUids.delete(uid); // A new authenticated load may legitimately use this UID again.
  try {
    const raw = await AsyncStorage.getItem(keyFor(uid));
    if (raw === null) return 'miss';
    const value = parseUnchecked(raw);
    if (!value || value.uid !== uid) {
      await removeIfUnchanged(uid, raw).catch(() => undefined);
      return 'invalid';
    }
    if (value.programInstanceId !== programInstanceId) {
      await removeIfUnchanged(uid, raw).catch(() => undefined);
      return 'program-mismatch';
    }
    return value;
  } catch {
    return 'miss';
  }
}

/** Write-through from a confirmed authoritative view only; callers own that boundary. */
export async function writeEvolutionSummaryPresentationCache(
  uid: string,
  programInstanceId: string,
  summary: ProgressingSummary,
): Promise<void> {
  const value: EvolutionSummaryPresentationCache = {
    schemaVersion: SCHEMA_VERSION,
    uid,
    programInstanceId,
    updatedAt: Date.now(),
    summary: {
      activeLevel: summary.activeLevel,
      cycleNumber: summary.cycleNumber,
      proximity: summary.proximity,
      activeDays: summary.activeDays,
      sessionsCompleted: summary.sessionsCompleted,
      adherenceQuality: summary.adherenceQuality,
    },
  };
  await enqueue(uid, async () => {
    if (!blockedUids.has(uid)) await AsyncStorage.setItem(keyFor(uid), JSON.stringify(value));
  });
}

export async function removeEvolutionSummaryPresentationCache(uid: string): Promise<void> {
  blockedUids.add(uid);
  await enqueue(uid, () => AsyncStorage.removeItem(keyFor(uid)));
}
