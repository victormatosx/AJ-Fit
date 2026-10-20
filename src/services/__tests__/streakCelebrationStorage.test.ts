import { beforeEach, describe, expect, it, vi } from 'vitest';

// A real in-memory store: these tests are about read-modify-write ordering,
// which a per-call `vi.fn()` stub could not express.
const store = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

import {
  claimStreakMilestoneCelebration,
  pruneStreakMilestoneCelebrations,
  readCelebratedStreakMilestones,
} from '../streakCelebrationStorage';

const UID = 'user-1';

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('claimStreakMilestoneCelebration', () => {
  it('grants the first claim and refuses the second for the same milestone', async () => {
    expect(await claimStreakMilestoneCelebration({ uid: UID, milestone: 3, current: 3 })).toBe(true);
    expect(await claimStreakMilestoneCelebration({ uid: UID, milestone: 3, current: 3 })).toBe(false);
  });

  it('grants exactly one claim when two callbacks race the same completion', async () => {
    const results = await Promise.all([
      claimStreakMilestoneCelebration({ uid: UID, milestone: 10, current: 10 }),
      claimStreakMilestoneCelebration({ uid: UID, milestone: 10, current: 10 }),
      claimStreakMilestoneCelebration({ uid: UID, milestone: 10, current: 10 }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('survives an app restart — the claim is read back from storage', async () => {
    await claimStreakMilestoneCelebration({ uid: UID, milestone: 30, current: 30 });
    // A restart is exactly "read the persisted value again".
    expect(await readCelebratedStreakMilestones(UID)).toEqual([30]);
    expect(await claimStreakMilestoneCelebration({ uid: UID, milestone: 30, current: 30 })).toBe(false);
  });

  it('scopes claims per user, so switching accounts does not inherit them', async () => {
    await claimStreakMilestoneCelebration({ uid: UID, milestone: 3, current: 3 });
    expect(await claimStreakMilestoneCelebration({ uid: 'user-2', milestone: 3, current: 3 })).toBe(true);
    expect(await readCelebratedStreakMilestones(UID)).toEqual([3]);
  });

  it('lets a broken-and-rebuilt streak earn the same milestone again', async () => {
    expect(await claimStreakMilestoneCelebration({ uid: UID, milestone: 3, current: 3 })).toBe(true);
    // Streak breaks; the first completion afterwards prunes.
    await pruneStreakMilestoneCelebrations({ uid: UID, current: 1 });
    expect(await readCelebratedStreakMilestones(UID)).toEqual([]);
    expect(await claimStreakMilestoneCelebration({ uid: UID, milestone: 3, current: 3 })).toBe(true);
  });

  it('keeps lower milestones claimed while releasing the ones the streak fell below', async () => {
    await claimStreakMilestoneCelebration({ uid: UID, milestone: 3, current: 3 });
    await claimStreakMilestoneCelebration({ uid: UID, milestone: 10, current: 10 });
    await pruneStreakMilestoneCelebrations({ uid: UID, current: 5 });
    expect(await readCelebratedStreakMilestones(UID)).toEqual([3]);
    // Reaching 10 again is a genuine new transformation.
    expect(await claimStreakMilestoneCelebration({ uid: UID, milestone: 10, current: 10 })).toBe(true);
    // 3 is still claimed — the user never dropped below it.
    expect(await claimStreakMilestoneCelebration({ uid: UID, milestone: 3, current: 10 })).toBe(false);
  });

  it('prunes higher milestones as part of the claim, not only via the separate prune call', async () => {
    store.set(`ajfit.streak.celebrated-milestones.v1:${UID}`, JSON.stringify([3, 10, 30]));
    // At streak 10, the 30 claim can no longer be justified and is released,
    // so the climb back to 30 will celebrate again. 10 itself stays claimed
    // (the user is standing on it), so this call is correctly silent.
    expect(await claimStreakMilestoneCelebration({ uid: UID, milestone: 10, current: 10 })).toBe(false);
    expect(await readCelebratedStreakMilestones(UID)).toEqual([3, 10]);
    expect(await claimStreakMilestoneCelebration({ uid: UID, milestone: 30, current: 30 })).toBe(true);
  });

  /**
   * Documents the one case the device-local record approximates rather than
   * resolves exactly. Releasing a milestone depends on observing a
   * completion while the streak is below it — which is the normal path
   * (a break drops the streak to ~1, and the next completion prunes). A
   * streak that reappears directly at a milestone without this app ever
   * seeing the low values in between (completions made on another device)
   * keeps the old claim and stays silent. Asserted so the limitation is a
   * known, reviewed behaviour instead of an accidental one.
   */
  it('stays silent when a streak returns to a milestone without this device observing the break', async () => {
    store.set(`ajfit.streak.celebrated-milestones.v1:${UID}`, JSON.stringify([3, 10]));
    expect(await claimStreakMilestoneCelebration({ uid: UID, milestone: 10, current: 10 })).toBe(false);
  });

  it('treats a corrupt entry as "nothing celebrated" instead of throwing', async () => {
    store.set(`ajfit.streak.celebrated-milestones.v1:${UID}`, 'not json');
    expect(await readCelebratedStreakMilestones(UID)).toEqual([]);
    expect(await claimStreakMilestoneCelebration({ uid: UID, milestone: 3, current: 3 })).toBe(true);
  });

  it('ignores non-numeric entries left by a corrupt partial write', async () => {
    store.set(`ajfit.streak.celebrated-milestones.v1:${UID}`, JSON.stringify([3, 'ten', null]));
    expect(await readCelebratedStreakMilestones(UID)).toEqual([3]);
  });
});

describe('pruneStreakMilestoneCelebrations', () => {
  it('writes nothing when there is nothing to release', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await claimStreakMilestoneCelebration({ uid: UID, milestone: 3, current: 3 });
    vi.mocked(AsyncStorage.setItem).mockClear();
    await pruneStreakMilestoneCelebrations({ uid: UID, current: 16 });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});
