import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserProfile, QuestionnaireDoc } from '../services/userProfile';
import type { Quiz } from '../state/AppState';

/** Only presentation data. Never use this projection for routing or mutations. */
export type ProfilePresentationCache = {
  schemaVersion: 1;
  uid: string;
  cachedAt: number;
  profile: { name: string } | null;
  questionnaire: { goal: Quiz['goal']; days: number | null } | null;
};

const SCHEMA_VERSION = 1;
const keyFor = (uid: string) => `ajfit:profile-presentation:v1:${uid}`;
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

export function parseProfilePresentationCache(raw: string, uid: string): ProfilePresentationCache | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION || value.uid !== uid ||
        typeof value.cachedAt !== 'number' || !Number.isFinite(value.cachedAt) ||
        value.cachedAt < 0 || value.cachedAt > Date.now() + 60_000) return null;
    if (value.profile !== null && (!isRecord(value.profile) ||
        typeof value.profile.name !== 'string' || value.profile.name.length > 150)) return null;
    if (value.questionnaire !== null) {
      if (!isRecord(value.questionnaire)) return null;
      const { goal, days } = value.questionnaire;
      if (goal !== null && (typeof goal !== 'string' || ![
        'gain_muscle', 'lose_fat', 'strength', 'conditioning', 'health', 'body_composition',
        'return_to_training', 'hyper', 'cut', 'perf', 'def', 'recon',
      ].includes(goal))) return null;
      if (days !== null && (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 7)) return null;
    }
    return value as ProfilePresentationCache;
  } catch {
    return null;
  }
}

export async function readProfilePresentationCache(uid: string): Promise<'miss' | 'invalid' | ProfilePresentationCache> {
  blockedUids.delete(uid); // A new authenticated load may use this UID again.
  try {
    const raw = await AsyncStorage.getItem(keyFor(uid));
    if (raw === null) return 'miss';
    const parsed = parseProfilePresentationCache(raw, uid);
    if (parsed) return parsed;
    await AsyncStorage.removeItem(keyFor(uid)).catch(() => undefined);
    return 'invalid';
  } catch {
    return 'miss';
  }
}

export async function writeProfilePresentationCache(
  uid: string,
  profile: UserProfile | null,
  questionnaire: QuestionnaireDoc | null,
): Promise<void> {
  const value: ProfilePresentationCache = {
    schemaVersion: SCHEMA_VERSION,
    uid,
    cachedAt: Date.now(),
    profile: profile ? { name: profile.profile.name } : null,
    questionnaire: questionnaire ? {
      goal: questionnaire.answers.goal,
      days: questionnaire.answers.days,
    } : null,
  };
  await enqueue(uid, async () => {
    if (!blockedUids.has(uid)) await AsyncStorage.setItem(keyFor(uid), JSON.stringify(value));
  });
}

/** Merge only after a server-acknowledged write. */
export async function updateProfilePresentationCache(
  uid: string,
  update: { name?: string; questionnaire?: Pick<Quiz, 'goal' | 'days'> },
): Promise<void> {
  await enqueue(uid, async () => {
    if (blockedUids.has(uid)) return;
    const raw = await AsyncStorage.getItem(keyFor(uid));
    const current = raw ? parseProfilePresentationCache(raw, uid) : null;
    if (!current) return;
    await AsyncStorage.setItem(keyFor(uid), JSON.stringify({
      ...current,
      cachedAt: Date.now(),
      profile: update.name === undefined ? current.profile : { name: update.name },
      questionnaire: update.questionnaire === undefined ? current.questionnaire : {
        goal: update.questionnaire.goal,
        days: update.questionnaire.days,
      },
    }));
  });
}

export async function removeProfilePresentationCache(uid: string): Promise<void> {
  blockedUids.add(uid);
  await enqueue(uid, () => AsyncStorage.removeItem(keyFor(uid)));
}
