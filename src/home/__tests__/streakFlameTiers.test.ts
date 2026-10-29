import { describe, expect, it } from 'vitest';

import {
  nextStreakMilestone,
  pruneCelebratedStreakMilestones,
  resolveStreakMilestoneCelebration,
  streakFlameTierForDays,
  STREAK_FLAME_TIERS,
  STREAK_MILESTONES,
} from '../streakFlameTiers';

describe('streakFlameTierForDays', () => {
  it('leaves the flame unlit below 1', () => {
    expect(streakFlameTierForDays(0)).toBeNull();
    expect(streakFlameTierForDays(-3)).toBeNull();
  });

  it('maps every documented boundary to the design tier', () => {
    const cases: [number, string | null][] = [
      [0, null],
      [1, 'spark'], [2, 'spark'],
      [3, 'flame'], [9, 'flame'],
      [10, 'ember'], [29, 'ember'],
      [30, 'blaze'], [99, 'blaze'],
      // 200 deliberately stays cyan: it is no longer a tier boundary.
      [100, 'plasma'], [199, 'plasma'], [200, 'plasma'], [249, 'plasma'],
      [250, 'stellar'], [499, 'stellar'],
      [500, 'legendary'], [501, 'legendary'], [700, 'legendary'], [5000, 'legendary'],
    ];
    for (const [days, id] of cases) {
      expect(streakFlameTierForDays(days)?.id ?? null, `days=${days}`).toBe(id);
    }
  });

  it('exposes exactly the seven design tiers, with no per-tier special effect', () => {
    expect(STREAK_FLAME_TIERS.map((tier) => tier.id)).toEqual([
      'spark', 'flame', 'ember', 'blaze', 'plasma', 'stellar', 'legendary',
    ]);
    // The Imortal halo was removed: every tier must share the same shape.
    for (const tier of STREAK_FLAME_TIERS) {
      expect(Object.keys(tier).sort()).toEqual(
        ['base', 'core', 'glowRgb', 'id', 'level', 'mid', 'min', 'top'],
      );
    }
  });

  it('treats non-finite input as unlit rather than throwing or guessing a tier', () => {
    expect(streakFlameTierForDays(Number.NaN)).toBeNull();
    expect(streakFlameTierForDays(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('nextStreakMilestone', () => {
  it('points at the next transformation, and at nothing past the maximum', () => {
    expect(nextStreakMilestone(0)).toBe(1);
    expect(nextStreakMilestone(1)).toBe(3);
    expect(nextStreakMilestone(2)).toBe(3);
    expect(nextStreakMilestone(3)).toBe(10);
    expect(nextStreakMilestone(10)).toBe(30);
    expect(nextStreakMilestone(30)).toBe(100);
    expect(nextStreakMilestone(100)).toBe(250);
    expect(nextStreakMilestone(200)).toBe(250);
    expect(nextStreakMilestone(250)).toBe(500);
    expect(nextStreakMilestone(500)).toBeNull();
    expect(nextStreakMilestone(999)).toBeNull();
  });
});

describe('resolveStreakMilestoneCelebration', () => {
  const resolve = (current: number, alreadyCelebrated: number[] = [], complete = true) =>
    resolveStreakMilestoneCelebration({ current, complete, alreadyCelebrated });

  // The exact table from the brief's "Mudança de nível" matrix.
  it.each([
    [1, true, 'unlit -> blue celebrates'],
    [2, false, 'an intermediate day is silent'],
    [3, true, 'blue -> yellow celebrates'],
    [4, false, 'the day after a milestone is silent'],
    [9, false, 'the day before a milestone is silent'],
    [10, true, 'yellow -> orange celebrates'],
    [11, false, 'the 11th is silent'],
    [29, false, 'the day before 30 is silent'],
    [30, true, 'orange -> red celebrates'],
    [99, false, 'the day before 100 is silent'],
    [100, true, 'red -> purple celebrates'],
    [199, false, 'the day before 200 is silent'],
    [200, false, '200 is no longer a milestone — it stays cyan'],
    [249, false, 'the day before 250 is silent'],
    [250, true, 'cyan -> white celebrates'],
    [251, false, 'the day after 250 is silent'],
    [499, false, 'the day before 500 is silent'],
    [500, true, 'white -> purple celebrates'],
    [501, false, 'past the maximum tier it is silent'],
    [700, false, 'far past the maximum tier it is silent'],
  ])('streak %i -> celebration: %s (%s)', (current, expected) => {
    expect(resolve(current) !== null).toBe(expected);
  });

  it('reports the unlit state as "Antes" for the very first day', () => {
    const first = resolve(1);
    expect(first).toMatchObject({ milestone: 1, to: { id: 'spark' }, next: 3 });
    // `null`, not a tier: day 0 has no flame at all, which is exactly what the
    // transformation screen must draw on the "Antes" side.
    expect(first?.from).toBeNull();
  });

  it('reports the previous tier as "Antes" and the reached tier as "Agora"', () => {
    expect(resolve(3)).toMatchObject({ milestone: 3, from: { id: 'spark' }, to: { id: 'flame' }, next: 10 });
    expect(resolve(10)).toMatchObject({ milestone: 10, from: { id: 'flame' }, to: { id: 'ember' }, next: 30 });
    expect(resolve(30)).toMatchObject({ milestone: 30, from: { id: 'ember' }, to: { id: 'blaze' }, next: 100 });
    expect(resolve(100)).toMatchObject({ milestone: 100, from: { id: 'blaze' }, to: { id: 'plasma' }, next: 250 });
    expect(resolve(250)).toMatchObject({ milestone: 250, from: { id: 'plasma' }, to: { id: 'stellar' }, next: 500 });
  });

  it('marks the 500 milestone as the maximum tier with no next marker', () => {
    expect(resolve(500)).toMatchObject({ from: { id: 'stellar' }, to: { id: 'legendary' }, next: null });
  });

  it('stays silent for a milestone already celebrated in this streak run', () => {
    expect(resolve(10, [3, 10])).toBeNull();
    // ...but an unclaimed one in the same run still fires.
    expect(resolve(10, [3])).not.toBeNull();
  });

  it('refuses an inexact streak, because `current` is then only a lower bound', () => {
    expect(resolve(30, [], false)).toBeNull();
    expect(resolve(30, [], true)).not.toBeNull();
  });

  it('never celebrates a value that is not exactly a milestone', () => {
    for (let days = 0; days <= 600; days += 1) {
      const celebration = resolve(days);
      if (celebration) expect(STREAK_MILESTONES).toContain(days);
    }
  });
});

describe('pruneCelebratedStreakMilestones', () => {
  it('keeps milestones the current streak still justifies', () => {
    expect(pruneCelebratedStreakMilestones([3, 10], 16)).toEqual([3, 10]);
    expect(pruneCelebratedStreakMilestones([3, 10], 10)).toEqual([3, 10]);
  });

  it('releases milestones the streak dropped below', () => {
    expect(pruneCelebratedStreakMilestones([3, 10], 5)).toEqual([3]);
    expect(pruneCelebratedStreakMilestones([3, 10], 0)).toEqual([]);
  });

  it('lets a rebuilt streak earn a released milestone again', () => {
    const afterBreak = pruneCelebratedStreakMilestones([3, 10], 0);
    expect(resolveStreakMilestoneCelebration({
      current: 3, complete: true, alreadyCelebrated: afterBreak,
    })).not.toBeNull();
  });

  it('does not permanently block a milestone reached once in the account lifetime', () => {
    // Reached 100 long ago, streak broke, user is rebuilding and hits 30.
    const stored = [3, 10, 30, 100];
    const pruned = pruneCelebratedStreakMilestones(stored, 30);
    expect(pruned).toEqual([3, 10, 30]);
    // 30 itself was re-earned in the PREVIOUS run and is still claimed, but
    // 100 is free again for when the rebuilt run gets there.
    expect(resolveStreakMilestoneCelebration({
      current: 100, complete: true, alreadyCelebrated: pruneCelebratedStreakMilestones(stored, 100),
    })).toBeNull();
    expect(resolveStreakMilestoneCelebration({
      current: 100, complete: true, alreadyCelebrated: pruned,
    })).not.toBeNull();
  });
});
