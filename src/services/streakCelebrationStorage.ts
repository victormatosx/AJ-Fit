/**
 * Per-uid record of which streak milestones already showed their
 * transformation screen.
 *
 * Deliberately local-only (`AsyncStorage`, scoped per uid), mirroring
 * `healthIntegrationOnboardingStep.ts`: this is a presentation fact ("did we
 * already play this animation on this device?"), not domain state. It
 * introduces NO Firestore field, no Rules change and no Cloud Function — the
 * streak itself stays exactly where it is (`src/home/streak.ts`, derived from
 * workout executions).
 *
 * Trade-off that choice accepts: a user who reaches a milestone and then
 * signs in on a second device could see that milestone's screen once more
 * there. Persisting it server-side would need a new user-scoped document and
 * a Rules change, which the brief asks to avoid unless strictly necessary —
 * replaying one animation on a fresh device is a far smaller cost than
 * widening the security surface, and nothing about the workout record,
 * schedule cursor or streak value is affected either way.
 *
 * The stored value is the pruned milestone list for the CURRENT streak run,
 * never an all-time history — see `pruneCelebratedStreakMilestones`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { pruneCelebratedStreakMilestones } from '../home/streakFlameTiers';

function celebratedKey(uid: string): string {
  return `ajfit.streak.celebrated-milestones.v1:${uid}`;
}

// Same global FIFO queue pattern as `healthIntegrationOnboardingStep.ts`, so
// a read-modify-write for one uid can never interleave with another. This is
// what makes two finalization callbacks arriving for the same completion
// serialize instead of both observing an empty list.
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

function parseMilestones(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  } catch {
    // A corrupt entry must never block a celebration forever, and must never
    // throw into the post-workout path. Treat it as "nothing celebrated yet".
    return [];
  }
}

export async function readCelebratedStreakMilestones(uid: string): Promise<number[]> {
  return withStorage(async () => parseMilestones(await AsyncStorage.getItem(celebratedKey(uid))));
}

/**
 * Atomically prunes the stored list against `current` and, if `milestone` is
 * still unclaimed, claims it — returning whether THIS call won the claim.
 *
 * Returning the claim result (rather than letting the caller read-then-write)
 * is the whole point: the read, the prune and the write happen inside one
 * queued operation, so a second concurrent call for the same completion sees
 * the already-claimed list and gets `false`.
 */
export async function claimStreakMilestoneCelebration(input: {
  uid: string;
  milestone: number;
  current: number;
}): Promise<boolean> {
  return withStorage(async () => {
    const stored = parseMilestones(await AsyncStorage.getItem(celebratedKey(input.uid)));
    const pruned = pruneCelebratedStreakMilestones(stored, input.current);
    if (pruned.includes(input.milestone)) {
      // Still persist the prune when it actually changed something, so a
      // broken-and-rebuilt streak doesn't keep stale milestones around.
      if (pruned.length !== stored.length) {
        await AsyncStorage.setItem(celebratedKey(input.uid), JSON.stringify(pruned));
      }
      return false;
    }
    const next = [...pruned, input.milestone].sort((a, b) => a - b);
    await AsyncStorage.setItem(celebratedKey(input.uid), JSON.stringify(next));
    return true;
  });
}

/**
 * Prunes without claiming. Used on a confirmed completion that did NOT land
 * on a milestone, so a broken streak releases its milestones at the first
 * completion after the break rather than waiting for the next milestone.
 */
export async function pruneStreakMilestoneCelebrations(input: {
  uid: string;
  current: number;
}): Promise<void> {
  await withStorage(async () => {
    const stored = parseMilestones(await AsyncStorage.getItem(celebratedKey(input.uid)));
    const pruned = pruneCelebratedStreakMilestones(stored, input.current);
    if (pruned.length === stored.length) return;
    await AsyncStorage.setItem(celebratedKey(input.uid), JSON.stringify(pruned));
  });
}
